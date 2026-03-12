import { DocumentEntity } from '../../domain/entities/document.entity';

export interface FileSecurityPort {
  assertSafe(document: DocumentEntity): Promise<void>;
}
