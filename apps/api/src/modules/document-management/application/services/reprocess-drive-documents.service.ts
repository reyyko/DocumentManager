import { Inject, Injectable } from '@nestjs/common';
import { extname } from 'path';

import { AuditLogRepository } from '../../domain/repositories/audit-log.repository';
import { DocumentRepository } from '../../domain/repositories/document.repository';
import {
  DriveFileClassificationStateRepository,
  DriveFileProcessingStatus,
} from '../../domain/repositories/drive-file-classification-state.repository';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { DriveStoragePort } from '../ports/drive-storage.port';
import { WorkflowQueuePort } from '../ports/workflow-queue.port';
import { getDriveFileId } from '../utils/drive-document-metadata';
import {
  AUDIT_LOG_REPOSITORY,
  DOCUMENT_QUEUE,
  DOCUMENT_REPOSITORY,
  DRIVE_CLASSIFICATION_STATE_REPOSITORY,
  DRIVE_STORAGE_PORT,
} from '../../document-management.tokens';
import { IngestDocumentService } from './ingest-document.service';

@Injectable()
export class ReprocessDriveDocumentsService {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documentRepository: DocumentRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
    @Inject(DOCUMENT_QUEUE) private readonly workflowQueue: WorkflowQueuePort,
    @Inject(DRIVE_STORAGE_PORT) private readonly driveStorage: DriveStoragePort,
    @Inject(DRIVE_CLASSIFICATION_STATE_REPOSITORY)
    private readonly driveStateRepository: DriveFileClassificationStateRepository,
    private readonly ingestDocumentService: IngestDocumentService,
  ) {}

  async execute(limit = 50, statuses: DocumentStatus[] = ['attention-required', 'failed']): Promise<{
    selected: number;
    queued: number;
    documentIds: string[];
  }> {
    const candidates = await this.documentRepository.listDriveRetryCandidates(limit, statuses);
    const driveStatuses = statuses.reduce<DriveFileProcessingStatus[]>((accumulator, status) => {
      if (status !== 'received') {
        accumulator.push(status as DriveFileProcessingStatus);
      }
      return accumulator;
    }, []);
    const queuedIds: string[] = [];
    let driveOnlySelected = 0;

    for (const document of candidates) {
      const previousStatus = document.status;
      document.markQueued();
      await this.documentRepository.update(document);

      const driveFileId = getDriveFileId(document);
      if (driveFileId) {
        await this.driveStateRepository.markQueued({
          googleDriveFileId: driveFileId,
          documentId: document.id,
          modifiedTime: document.metadata.sourceModifiedAt,
          originalName: document.originalFileName,
          sourcePath: document.metadata.sourcePath,
        });
      }

      await this.auditLogRepository.append({
        documentId: document.id,
        eventType: 'document.reprocess.queued',
        actor: 'system:drive-reprocess',
        payload: {
          previousStatus,
          source: document.source,
        },
      });
      await this.workflowQueue.enqueueDocumentAnalysis(document.id);
      queuedIds.push(document.id);
    }

    const remainingSlots = Math.max(limit - queuedIds.length, 0);
    if (remainingSlots > 0) {
      const driveOnlyCandidates = await this.driveStateRepository.listRetryCandidates(
        remainingSlots,
        driveStatuses,
        true,
      );
      driveOnlySelected = driveOnlyCandidates.length;

      for (const state of driveOnlyCandidates) {
        try {
          const archiveClassification = this.buildDirectArchiveClassification(
            state.originalName ?? state.googleDriveFileId,
            state.lastSeenModifiedTime,
          );
          if (archiveClassification) {
            await this.driveStorage.classifyExistingDocument({
              fileId: state.googleDriveFileId,
              fileName: archiveClassification.fileName,
              folderPath: archiveClassification.destinationPath,
            });
            await this.driveStateRepository.markClassified({
              googleDriveFileId: state.googleDriveFileId,
              documentId: state.documentId,
              standardizedName: archiveClassification.fileName,
              destinationPath: archiveClassification.destinationPath,
              category: archiveClassification.category,
              confidence: 0.99,
              classificationPayload: {
                summary: archiveClassification.summary,
                destinationPath: archiveClassification.destinationPath,
                suggestedName: archiveClassification.fileName,
                extractedFields: {
                  type: archiveClassification.category,
                  source: 'google-drive',
                },
              },
            });
            continue;
          }

          const download = await this.driveStorage.downloadFile(state.googleDriveFileId);
          if (!download) {
            await this.driveStateRepository.markFailed({
              googleDriveFileId: state.googleDriveFileId,
              reason: 'Impossible de telecharger le fichier Google Drive lors du retraitement',
            });
            continue;
          }

          const sourceId = `gdrive:${state.googleDriveFileId}:${download.modifiedTime ?? state.lastSeenModifiedTime ?? 'unknown'}`;
          const existingDocument = await this.documentRepository.findBySourceId('google-drive', sourceId);
          if (existingDocument) {
            await this.driveStateRepository.markQueued({
              googleDriveFileId: state.googleDriveFileId,
              documentId: existingDocument.id,
              modifiedTime: download.modifiedTime ?? state.lastSeenModifiedTime ?? undefined,
              originalName: download.name,
              sourcePath: download.path ?? state.sourcePath ?? undefined,
            });
            await this.workflowQueue.enqueueDocumentAnalysis(existingDocument.id);
            queuedIds.push(existingDocument.id);
            continue;
          }

          const result = await this.ingestDocumentService.execute({
            source: 'google-drive',
            originalFileName: download.name,
            contentBase64: download.contentBase64,
            metadata: {
              sourceId,
              sourceLabel: 'Google Drive Reprocess',
              mimeType: download.mimeType ?? 'application/octet-stream',
              sizeBytes: download.sizeBytes,
              externalReference: download.webViewLink ?? state.googleDriveFileId,
              receivedAt: new Date().toISOString(),
              googleDriveFileId: state.googleDriveFileId,
              sourcePath: download.path ?? state.sourcePath ?? undefined,
              sourceModifiedAt: download.modifiedTime ?? state.lastSeenModifiedTime ?? undefined,
              driveWebViewLink: download.webViewLink,
              parentFolderIds: download.parentIds,
            },
          });
          queuedIds.push(result.documentId);
        } catch (error) {
          await this.driveStateRepository.markFailed({
            googleDriveFileId: state.googleDriveFileId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      selected: candidates.length + driveOnlySelected,
      queued: queuedIds.length,
      documentIds: queuedIds,
    };
  }

  private buildDirectArchiveClassification(
    originalName: string,
    lastSeenModifiedTime: string | null,
  ): {
    fileName: string;
    destinationPath: string;
    category: string;
    summary: string;
  } | null {
    const suffix = extname(originalName).toLowerCase();
    const baseName = originalName.replace(/\.[^.]+$/, '');
    const slug = this.slug(baseName);
    const documentDate = (lastSeenModifiedTime ?? new Date().toISOString()).slice(0, 10);
    const [year = '1970', month = '01'] = documentDate.split('-');

    if (suffix === '.mp3') {
      return {
        fileName: `${documentDate}_audio_${slug}${suffix}`,
        destinationPath: `Archives/Medias/Audio/${year}/${month}`,
        category: 'archives.media.audio',
        summary: 'Fichier audio archive directement depuis Google Drive.',
      };
    }

    if (suffix === '.mp4') {
      return {
        fileName: `${documentDate}_video_${slug}${suffix}`,
        destinationPath: `Archives/Medias/Video/${year}/${month}`,
        category: 'archives.media.video',
        summary: 'Fichier video archive directement depuis Google Drive.',
      };
    }

    if (suffix === '.zip' || suffix === '.rar') {
      return {
        fileName: `${documentDate}_archive_${slug}${suffix}`,
        destinationPath: `Archives/Fichiers-Compresses/${year}/${month}`,
        category: 'archives.compressed',
        summary: 'Archive compressee archivee directement depuis Google Drive.',
      };
    }

    return null;
  }

  private slug(value: string): string {
    return (
      value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\x00-\x7F]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'document'
    );
  }
}
