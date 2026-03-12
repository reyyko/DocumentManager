import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
import { extname, resolve } from 'path';

import { DocumentEntity } from '../../domain/entities/document.entity';
import { AuditLogRepository } from '../../domain/repositories/audit-log.repository';
import { DocumentRepository } from '../../domain/repositories/document.repository';
import { DriveFileClassificationStateRepository } from '../../domain/repositories/drive-file-classification-state.repository';
import { IngestDocumentInput, ingestDocumentSchema } from '../dto/ingest-document.input';
import { DiscordNotificationPort } from '../ports/discord-notification.port';
import { FileSecurityPort } from '../ports/file-security.port';
import { RequestSignaturePort } from '../ports/request-signature.port';
import { WorkflowQueuePort } from '../ports/workflow-queue.port';
import { getDriveFileId } from '../utils/drive-document-metadata';
import {
  AUDIT_LOG_REPOSITORY,
  DISCORD_NOTIFICATION_PORT,
  DRIVE_CLASSIFICATION_STATE_REPOSITORY,
  DOCUMENT_QUEUE,
  DOCUMENT_REPOSITORY,
  FILE_SECURITY_PORT,
  REQUEST_SIGNATURE_PORT,
} from '../../document-management.tokens';

@Injectable()
export class IngestDocumentService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(DOCUMENT_REPOSITORY) private readonly documentRepository: DocumentRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
    @Inject(FILE_SECURITY_PORT) private readonly fileSecurity: FileSecurityPort,
    @Inject(REQUEST_SIGNATURE_PORT) private readonly requestSignature: RequestSignaturePort,
    @Inject(DISCORD_NOTIFICATION_PORT) private readonly discordNotifier: DiscordNotificationPort,
    @Inject(DOCUMENT_QUEUE) private readonly workflowQueue: WorkflowQueuePort,
    @Inject(DRIVE_CLASSIFICATION_STATE_REPOSITORY)
    private readonly driveStateRepository: DriveFileClassificationStateRepository,
  ) {}

  async execute(payload: IngestDocumentInput): Promise<{ documentId: string; status: string }> {
    const input = ingestDocumentSchema.parse(payload);
    await this.requestSignature.assertIntegrity(input);

    const existing = await this.documentRepository.findBySourceId(input.source, input.metadata.sourceId);
    if (existing) {
      await this.auditLogRepository.append({
        documentId: existing.id,
        eventType: 'document.duplicate.skipped',
        actor: `source:${input.source}`,
        payload: {
          sourceId: input.metadata.sourceId,
          originalFileName: input.originalFileName,
        },
      });

      return {
        documentId: existing.id,
        status: existing.status,
      };
    }

    const document = DocumentEntity.create(input);
    await this.fileSecurity.assertSafe(document);
    await this.persistInboundFile(document);

    document.markQueued();
    await this.documentRepository.save(document);
    await this.auditLogRepository.append({
      documentId: document.id,
      eventType: 'document.received',
      actor: `source:${document.source}`,
      payload: {
        metadata: document.metadata,
        originalFileName: document.originalFileName,
      },
    });

    await this.discordNotifier.notifyQueue(document.originalFileName, document.source);
    await this.workflowQueue.enqueueDocumentAnalysis(document.id);
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
      eventType: 'document.queued',
      actor: 'system:workflow',
      payload: {},
    });

    return {
      documentId: document.id,
      status: document.status,
    };
  }

  private async persistInboundFile(document: DocumentEntity): Promise<void> {
    const configuredDir = this.configService.get<string>('documentManagement.storage.documentStorageDir') ?? 'data/inbound';
    const storageDir = resolve(configuredDir);
    await mkdir(storageDir, { recursive: true });

    const suffix = extname(document.originalFileName) || this.defaultExtension(document.metadata.mimeType);
    const outputPath = resolve(storageDir, `${document.id}${suffix}`);
    await writeFile(outputPath, Buffer.from(document.contentBase64, 'base64'));
  }

  private defaultExtension(mimeType: string): string {
    if (mimeType === 'application/pdf') {
      return '.pdf';
    }
    if (mimeType.startsWith('image/jpeg')) {
      return '.jpg';
    }
    if (mimeType.startsWith('image/png')) {
      return '.png';
    }
    if (mimeType.includes('word')) {
      return '.docx';
    }
    return '.bin';
  }
}
