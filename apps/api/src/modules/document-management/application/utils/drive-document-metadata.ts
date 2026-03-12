import { DocumentEntity } from '../../domain/entities/document.entity';

export function getDriveFileId(document: DocumentEntity): string | null {
  return document.metadata.googleDriveFileId?.trim() || null;
}

export function isDriveBackedDocument(document: DocumentEntity): boolean {
  return Boolean(getDriveFileId(document));
}
