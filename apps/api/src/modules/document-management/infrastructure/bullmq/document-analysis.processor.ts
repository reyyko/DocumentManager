import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';

import { AnalyzeDocumentService } from '../../application/services/analyze-document.service';
import { AuditLogRepository } from '../../domain/repositories/audit-log.repository';
import { DocumentRepository } from '../../domain/repositories/document.repository';
import { DriveFileClassificationStateRepository } from '../../domain/repositories/drive-file-classification-state.repository';
import { getDriveFileId } from '../../application/utils/drive-document-metadata';
import {
  AUDIT_LOG_REPOSITORY,
  DOCUMENT_REPOSITORY,
  DRIVE_CLASSIFICATION_STATE_REPOSITORY,
} from '../../document-management.tokens';

@Injectable()
@Processor('document-analysis', { concurrency: 3 })
export class DocumentAnalysisProcessor extends WorkerHost {
  constructor(
    private readonly analyzeDocumentService: AnalyzeDocumentService,
    @Inject(DOCUMENT_REPOSITORY) private readonly documentRepository: DocumentRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
    @Inject(DRIVE_CLASSIFICATION_STATE_REPOSITORY)
    private readonly driveStateRepository: DriveFileClassificationStateRepository,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
    try {
      await this.analyzeDocumentService.execute(job.data.documentId);
    } catch (error) {
      const maxAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
      const finalAttempt = job.attemptsMade + 1 >= maxAttempts;

      await this.auditLogRepository.append({
        documentId: job.data.documentId,
        eventType: finalAttempt ? 'document.processing.failed' : 'document.processing.retry',
        actor: 'worker:bullmq',
        payload: {
          attemptsMade: job.attemptsMade + 1,
          maxAttempts,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      if (finalAttempt) {
        const document = await this.documentRepository.findById(job.data.documentId);
        if (document) {
          document.markFailed(error instanceof Error ? error.message : String(error));
          await this.documentRepository.update(document);
          const driveFileId = getDriveFileId(document);
          if (driveFileId) {
            await this.driveStateRepository.markFailed({
              googleDriveFileId: driveFileId,
              documentId: document.id,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      throw error;
    }
  }
}
