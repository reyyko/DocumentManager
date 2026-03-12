import { Inject, Injectable } from '@nestjs/common';

import { DocumentEntity } from '../../domain/entities/document.entity';
import { AuditLogRepository } from '../../domain/repositories/audit-log.repository';
import { DocumentRepository } from '../../domain/repositories/document.repository';
import { AUDIT_LOG_REPOSITORY, DOCUMENT_REPOSITORY } from '../../document-management.tokens';

@Injectable()
export class DocumentQueryService {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documentRepository: DocumentRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async listRecent(limit: number) {
    return (await this.documentRepository.listRecent(limit)).map((document) => this.toView(document));
  }

  async getDocument(documentId: string) {
    const document = await this.documentRepository.findById(documentId);
    return document ? this.toView(document) : null;
  }

  async getAuditTrail(documentId: string) {
    return this.auditLogRepository.listByDocumentId(documentId);
  }

  private toView(document: DocumentEntity) {
    return {
      id: document.id,
      source: document.source,
      originalFileName: document.originalFileName,
      metadata: document.metadata,
      status: document.status,
      classification: document.classification,
      storageFileId: document.storageFileId,
      failureReason: document.failureReason,
    };
  }
}
