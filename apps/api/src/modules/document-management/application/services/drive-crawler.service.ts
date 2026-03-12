import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DriveStoragePort, DriveScanCandidate } from '../ports/drive-storage.port';
import { IngestDocumentService } from './ingest-document.service';
import { DriveFileClassificationStateRepository } from '../../domain/repositories/drive-file-classification-state.repository';
import { DocumentRepository } from '../../domain/repositories/document.repository';
import {
  DRIVE_CLASSIFICATION_STATE_REPOSITORY,
  DOCUMENT_REPOSITORY,
  DRIVE_STORAGE_PORT,
} from '../../document-management.tokens';

@Injectable()
export class DriveCrawlerService {
  private readonly logger = new Logger(DriveCrawlerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly ingestDocumentService: IngestDocumentService,
    @Inject(DRIVE_STORAGE_PORT) private readonly driveStorage: DriveStoragePort,
    @Inject(DOCUMENT_REPOSITORY) private readonly documentRepository: DocumentRepository,
    @Inject(DRIVE_CLASSIFICATION_STATE_REPOSITORY)
    private readonly driveStateRepository: DriveFileClassificationStateRepository,
  ) {}

  async scanAndQueueDocuments(): Promise<{
    scanned: number;
    queued: number;
    skipped: number;
    failed: number;
  }> {
    const folderIds = this.configService.get<string[]>('documentManagement.driveCrawler.folderIds') ?? [];
    const batchSize = this.configService.get<number>('documentManagement.driveCrawler.batchSize') ?? 50;

    if (!folderIds.length || batchSize <= 0) {
      return {
        scanned: 0,
        queued: 0,
        skipped: 0,
        failed: 0,
      };
    }

    const candidates = await this.driveStorage.scanFolders(folderIds, batchSize);
    let queued = 0;
    let skipped = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        const existing = await this.driveStateRepository.findByFileId(candidate.fileId);
        if (this.shouldSkipCandidate(existing, candidate)) {
          skipped += 1;
          continue;
        }

        await this.driveStateRepository.recordDiscovered({
          googleDriveFileId: candidate.fileId,
          originalName: candidate.name,
          sourcePath: candidate.path,
          modifiedTime: candidate.modifiedTime,
          parentFolderIds: candidate.parentIds,
          webViewLink: candidate.webViewLink,
        });

        if (!this.isSupportedDocumentMimeType(candidate.mimeType)) {
          await this.driveStateRepository.markFailed({
            googleDriveFileId: candidate.fileId,
            reason: `Skipped unsupported mime type ${candidate.mimeType ?? 'unknown'}`,
          });
          skipped += 1;
          continue;
        }

        const download = await this.driveStorage.downloadFile(candidate.fileId);
        if (!download) {
          await this.driveStateRepository.markFailed({
            googleDriveFileId: candidate.fileId,
            reason: 'Impossible de telecharger le fichier Google Drive',
          });
          failed += 1;
          continue;
        }

        const result = await this.ingestDocumentService.execute({
          source: candidate.mimeType?.startsWith('application/vnd.google-apps.document') ? 'google-docs' : 'google-drive',
          originalFileName: candidate.name,
          contentBase64: download.contentBase64,
          metadata: {
            sourceId: `gdrive:${candidate.fileId}:${candidate.modifiedTime ?? 'unknown'}`,
            sourceLabel: 'Google Drive Crawler',
            mimeType: download.mimeType ?? candidate.mimeType ?? 'application/octet-stream',
            sizeBytes: download.sizeBytes,
            externalReference: candidate.webViewLink ?? candidate.fileId,
            receivedAt: new Date().toISOString(),
            googleDriveFileId: candidate.fileId,
            sourcePath: candidate.path,
            sourceModifiedAt: candidate.modifiedTime,
            driveWebViewLink: candidate.webViewLink,
            parentFolderIds: candidate.parentIds,
          },
        });

        const document = await this.documentRepository.findById(result.documentId);
        if (document?.classification && result.status === 'classified') {
          await this.driveStateRepository.markClassified({
            googleDriveFileId: candidate.fileId,
            documentId: document.id,
            standardizedName: document.classification.suggestedName,
            destinationPath: document.classification.destinationPath,
            category: document.classification.category,
            confidence: document.classification.confidence,
            supplier: this.extractFieldAsString(document.classification.extractedFields, 'issuer', 'supplier', 'counterparty'),
            amount: this.extractFieldAsString(document.classification.extractedFields, 'amount', 'totalAmount'),
            classificationPayload: {
              summary: document.classification.summary,
              destinationPath: document.classification.destinationPath,
              suggestedName: document.classification.suggestedName,
              extractedFields: document.classification.extractedFields,
            },
          });
        } else if (document?.classification && result.status === 'attention-required') {
          await this.driveStateRepository.markAttentionRequired({
            googleDriveFileId: candidate.fileId,
            documentId: document.id,
            standardizedName: document.classification.suggestedName,
            destinationPath: document.classification.destinationPath,
            category: document.classification.category,
            confidence: document.classification.confidence,
            supplier: this.extractFieldAsString(document.classification.extractedFields, 'issuer', 'supplier', 'counterparty'),
            amount: this.extractFieldAsString(document.classification.extractedFields, 'amount', 'totalAmount'),
            attentionReason: document.classification.attentionReason ?? 'Qualification manuelle requise',
            classificationPayload: {
              summary: document.classification.summary,
              destinationPath: document.classification.destinationPath,
              suggestedName: document.classification.suggestedName,
              extractedFields: document.classification.extractedFields,
            },
          });
        } else if (document?.classification && result.status === 'pending-approval') {
          await this.driveStateRepository.markPendingApproval({
            googleDriveFileId: candidate.fileId,
            documentId: document.id,
            standardizedName: document.classification.suggestedName,
            destinationPath: document.classification.destinationPath,
            category: document.classification.category,
            confidence: document.classification.confidence,
            supplier: this.extractFieldAsString(document.classification.extractedFields, 'issuer', 'supplier', 'counterparty'),
            amount: this.extractFieldAsString(document.classification.extractedFields, 'amount', 'totalAmount'),
            attentionReason: document.classification.attentionReason,
            classificationPayload: {
              summary: document.classification.summary,
              destinationPath: document.classification.destinationPath,
              suggestedName: document.classification.suggestedName,
              extractedFields: document.classification.extractedFields,
            },
          });
        } else if (result.status === 'failed') {
          await this.driveStateRepository.markFailed({
            googleDriveFileId: candidate.fileId,
            documentId: result.documentId,
            reason: document?.failureReason ?? 'Echec de traitement deja enregistre',
          });
        } else {
          await this.driveStateRepository.markQueued({
            googleDriveFileId: candidate.fileId,
            documentId: result.documentId,
            modifiedTime: candidate.modifiedTime,
            originalName: candidate.name,
            sourcePath: candidate.path,
          });
        }
        queued += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Drive crawler failed for ${candidate.fileId}`,
          error instanceof Error ? error.stack : String(error),
        );
        await this.driveStateRepository.markFailed({
          googleDriveFileId: candidate.fileId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log(
      `Drive crawl completed: scanned=${candidates.length} queued=${queued} skipped=${skipped} failed=${failed}`,
    );

    return {
      scanned: candidates.length,
      queued,
      skipped,
      failed,
    };
  }

  private extractFieldAsString(
    fields: Record<string, string | number | boolean | null>,
    ...keys: string[]
  ): string | null {
    for (const key of keys) {
      const value = fields[key];
      if (value === null || value === undefined || value === false) {
        continue;
      }

      return String(value);
    }

    return null;
  }

  private shouldSkipCandidate(
    existing: Awaited<ReturnType<DriveFileClassificationStateRepository['findByFileId']>>,
    candidate: DriveScanCandidate,
  ): boolean {
    if (!existing) {
      return false;
    }

    const sameVersion = (existing.lastSeenModifiedTime ?? null) === (candidate.modifiedTime ?? null);
    if (!sameVersion) {
      return false;
    }

    return [
      'queued',
      'processing',
      'pending-approval',
      'attention-required',
      'classified',
    ].includes(existing.status);
  }

  private isSupportedDocumentMimeType(mimeType: string | undefined): boolean {
    if (!mimeType) {
      return false;
    }

    return [
      'application/pdf',
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
      'text/csv',
      'audio/',
      'video/',
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/rar',
    ].some((prefix) => mimeType.startsWith(prefix));
  }
}
