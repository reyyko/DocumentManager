import { Inject, Injectable } from '@nestjs/common';

import { AuditLogRepository } from '../../domain/repositories/audit-log.repository';
import { DocumentRepository } from '../../domain/repositories/document.repository';
import { DriveFileClassificationStateRepository } from '../../domain/repositories/drive-file-classification-state.repository';
import { AiAnalysisPort } from '../ports/ai-analysis.port';
import { ApprovalGatePort } from '../ports/approval-gate.port';
import { DiscordNotificationPort } from '../ports/discord-notification.port';
import { DriveStoragePort } from '../ports/drive-storage.port';
import { getDriveFileId } from '../utils/drive-document-metadata';
import {
  AI_ANALYSIS_PORT,
  APPROVAL_GATE_PORT,
  AUDIT_LOG_REPOSITORY,
  DISCORD_NOTIFICATION_PORT,
  DRIVE_CLASSIFICATION_STATE_REPOSITORY,
  DOCUMENT_REPOSITORY,
  DRIVE_STORAGE_PORT,
} from '../../document-management.tokens';

@Injectable()
export class AnalyzeDocumentService {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documentRepository: DocumentRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
    @Inject(AI_ANALYSIS_PORT) private readonly aiAnalysis: AiAnalysisPort,
    @Inject(DRIVE_STORAGE_PORT) private readonly driveStorage: DriveStoragePort,
    @Inject(DISCORD_NOTIFICATION_PORT) private readonly discordNotifier: DiscordNotificationPort,
    @Inject(APPROVAL_GATE_PORT) private readonly approvalGate: ApprovalGatePort,
    @Inject(DRIVE_CLASSIFICATION_STATE_REPOSITORY)
    private readonly driveStateRepository: DriveFileClassificationStateRepository,
  ) {}

  async execute(documentId: string): Promise<void> {
    const document = await this.documentRepository.findById(documentId);

    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    const driveFileId = getDriveFileId(document);
    document.markProcessing();
    await this.documentRepository.update(document);
    if (driveFileId) {
      await this.driveStateRepository.markProcessing(driveFileId, document.id);
    }
    await this.auditLogRepository.append({
      documentId,
      eventType: 'document.processing.started',
      actor: 'worker:bullmq',
      payload: {},
    });

    const analysis = await this.aiAnalysis.analyze(document);
    const classification = {
      category: analysis.category,
      destinationPath: analysis.destinationPath,
      suggestedName: analysis.suggestedName,
      confidence: analysis.confidence,
      summary: analysis.summary,
      extractedFields: analysis.extractedFields,
      sensitivity: analysis.sensitivity,
      requiresApproval: analysis.requiresApproval,
      reason: analysis.approvalReason,
      requiresAttention: analysis.requiresAttention,
      attentionReason: analysis.attentionReason,
    };

    if (analysis.requiresApproval) {
      const approverDiscordId = await this.approvalGate.resolveApprover(document);
      document.markPendingApproval(classification);
      await this.documentRepository.update(document);
      if (driveFileId) {
        await this.driveStateRepository.markPendingApproval({
          googleDriveFileId: driveFileId,
          documentId: document.id,
          standardizedName: analysis.suggestedName,
          destinationPath: analysis.destinationPath,
          category: analysis.category,
          confidence: analysis.confidence,
          supplier: this.extractFieldAsString(analysis.extractedFields, 'issuer', 'supplier', 'counterparty'),
          amount: this.extractFieldAsString(analysis.extractedFields, 'amount', 'totalAmount'),
          attentionReason: analysis.attentionReason,
          classificationPayload: {
            summary: analysis.summary,
            destinationPath: analysis.destinationPath,
            suggestedName: analysis.suggestedName,
            extractedFields: analysis.extractedFields,
          },
        });
      }
      await this.auditLogRepository.append({
        documentId,
        eventType: 'document.approval.requested',
        actor: 'ai:analysis',
        payload: {
          approverDiscordId,
          reason: analysis.approvalReason ?? 'Sensitive document',
        },
      });
      await this.discordNotifier.notifyApprovalRequired({
        documentId,
        approverDiscordId,
        reason: analysis.approvalReason ?? 'Sensitive document',
        documentName: document.originalFileName,
      });
      return;
    }

    const fileId = driveFileId
      ? await this.driveStorage.classifyExistingDocument({
          fileId: driveFileId,
          fileName: analysis.suggestedName,
          folderPath: analysis.destinationPath,
        })
      : await this.driveStorage.storeDocument({
          fileName: analysis.suggestedName,
          folderPath: analysis.destinationPath,
          mimeType: document.metadata.mimeType,
          contentBase64: document.contentBase64,
        });
    await this.driveStorage.ensureFolderLoop(analysis.destinationPath);

    if (analysis.requiresAttention) {
      document.markAttentionRequired(classification, fileId);
      await this.documentRepository.update(document);
      if (driveFileId) {
        await this.driveStateRepository.markAttentionRequired({
          googleDriveFileId: driveFileId,
          documentId: document.id,
          standardizedName: analysis.suggestedName,
          destinationPath: analysis.destinationPath,
          category: analysis.category,
          confidence: analysis.confidence,
          supplier: this.extractFieldAsString(analysis.extractedFields, 'issuer', 'supplier', 'counterparty'),
          amount: this.extractFieldAsString(analysis.extractedFields, 'amount', 'totalAmount'),
          attentionReason: analysis.attentionReason ?? 'Classification ambigue',
          classificationPayload: {
            summary: analysis.summary,
            destinationPath: analysis.destinationPath,
            suggestedName: analysis.suggestedName,
            extractedFields: analysis.extractedFields,
          },
        });
      }
      await this.auditLogRepository.append({
        documentId,
        eventType: 'document.attention.required',
        actor: 'ai:analysis',
        payload: {
          fileId,
          destinationPath: analysis.destinationPath,
          reason: analysis.attentionReason ?? 'Classification ambigue',
        },
      });
      await this.discordNotifier.notifyAttentionRequired({
        documentId,
        documentName: analysis.suggestedName,
        reason: analysis.attentionReason ?? 'Classification ambigue',
        destinationPath: analysis.destinationPath,
      });
      return;
    }

    document.markClassified(classification, fileId);
    await this.documentRepository.update(document);
    if (driveFileId) {
      await this.driveStateRepository.markClassified({
        googleDriveFileId: driveFileId,
        documentId: document.id,
        standardizedName: analysis.suggestedName,
        destinationPath: analysis.destinationPath,
        category: analysis.category,
        confidence: analysis.confidence,
        supplier: this.extractFieldAsString(analysis.extractedFields, 'issuer', 'supplier', 'counterparty'),
        amount: this.extractFieldAsString(analysis.extractedFields, 'amount', 'totalAmount'),
        classificationPayload: {
          summary: analysis.summary,
          destinationPath: analysis.destinationPath,
          suggestedName: analysis.suggestedName,
          extractedFields: analysis.extractedFields,
        },
      });
    }
    await this.auditLogRepository.append({
      documentId,
      eventType: 'document.classified',
      actor: 'ai:analysis',
      payload: {
        fileId,
        destinationPath: analysis.destinationPath,
        category: analysis.category,
      },
    });
    await this.discordNotifier.notifyClassification({
      documentId,
      destinationPath: analysis.destinationPath,
      target: analysis.notificationTarget,
      summary: analysis.summary,
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
