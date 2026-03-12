import { DocumentEntity } from '../entities/document.entity';
import { DocumentSource } from '../value-objects/document-source.vo';
import { DocumentStatus } from '../value-objects/document-status.vo';

export interface DocumentRepository {
  save(document: DocumentEntity): Promise<void>;
  update(document: DocumentEntity): Promise<void>;
  findById(documentId: string): Promise<DocumentEntity | null>;
  findBySourceId(source: DocumentSource, sourceId: string): Promise<DocumentEntity | null>;
  listRecent(limit: number): Promise<DocumentEntity[]>;
  listDriveRetryCandidates(limit: number, statuses: DocumentStatus[]): Promise<DocumentEntity[]>;
}
