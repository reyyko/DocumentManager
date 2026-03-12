import { Inject, Injectable } from '@nestjs/common';

import { AuditLogRepository } from '../../domain/repositories/audit-log.repository';
import { DocumentRepository } from '../../domain/repositories/document.repository';
import { DriveFileClassificationStateRepository } from '../../domain/repositories/drive-file-classification-state.repository';
import { ApprovalDecision } from '../ports/approval-gate.port';
import { DiscordNotificationPort } from '../ports/discord-notification.port';
import { DriveStoragePort } from '../ports/drive-storage.port';
import { getDriveFileId } from '../utils/drive-document-metadata';
import {
  AUDIT_LOG_REPOSITORY,
  DISCORD_NOTIFICATION_PORT,
  DRIVE_CLASSIFICATION_STATE_REPOSITORY,
  DOCUMENT_REPOSITORY,
  DRIVE_STORAGE_PORT,
} from '../../document-management.tokens';

@Injectable()
export class ApproveDocumentService {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documentRepository: DocumentRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
    @Inject(DRIVE_STORAGE_PORT) private readonly driveStorage: DriveStoragePort,
    @Inject(DISCORD_NOTIFICATION_PORT) private readonly discordNotifier: DiscordNotificationPort,
    @Inject(DRIVE_CLASSIFICATION_STATE_REPOSITORY)
    private readonly driveStateRepository: DriveFileClassificationStateRepository,
  ) {}

  async execute(documentId: string, decision: ApprovalDecision): Promise<void> {
    const document = await this.documentRepository.findById(documentId);

    if (!document || !document.classification) {
      throw new Error(`Pending approval document ${documentId} not found`);
    }

    if (!decision.approved) {
      document.markFailed(decision.comment ?? 'Rejected during human approval');
      await this.documentRepository.update(document);
      const driveFileId = getDriveFileId(document);
      if (driveFileId) {
        await this.driveStateRepository.markFailed({
          googleDriveFileId: driveFileId,
          documentId,
          reason: decision.comment ?? 'Rejected during human approval',
        });
      }
      await this.auditLogRepository.append({
        documentId,
        eventType: 'document.approval.rejected',
        actor: `discord:${decision.approverDiscordId}`,
        payload: {
          comment: decision.comment ?? null,
        },
      });
      return;
    }

    const driveFileId = getDriveFileId(document);
    const fileId = driveFileId
      ? await this.driveStorage.classifyExistingDocument({
          fileId: driveFileId,
          fileName: document.classification.suggestedName,
          folderPath: document.classification.destinationPath,
        })
      : await this.driveStorage.storeDocument({
          fileName: document.classification.suggestedName,
          folderPath: document.classification.destinationPath,
          mimeType: document.metadata.mimeType,
          contentBase64: document.contentBase64,
        });
    await this.driveStorage.ensureFolderLoop(document.classification.destinationPath);

    document.markClassified(document.classification, fileId);
    await this.documentRepository.update(document);
    if (driveFileId) {
      await this.driveStateRepository.markClassified({
        googleDriveFileId: driveFileId,
        documentId,
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
    }
    await this.auditLogRepository.append({
      documentId,
      eventType: 'document.approval.approved',
      actor: `discord:${decision.approverDiscordId}`,
      payload: {
        fileId,
        destinationPath: document.classification.destinationPath,
      },
    });
    await this.discordNotifier.notifyClassification({
      documentId,
      destinationPath: document.classification.destinationPath,
      target: 'general',
      summary: document.classification.summary,
    });
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
}
