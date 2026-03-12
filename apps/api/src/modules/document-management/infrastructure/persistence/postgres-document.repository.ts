import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { DocumentEntity, DocumentMetadata, DocumentClassification } from '../../domain/entities/document.entity';
import { DocumentRepository } from '../../domain/repositories/document.repository';
import { DocumentSource } from '../../domain/value-objects/document-source.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { PG_POOL } from '../../document-management.tokens';

interface DocumentRow {
  id: string;
  source: DocumentSource;
  original_file_name: string;
  content_base64: string;
  metadata: DocumentMetadata;
  status: DocumentStatus;
  classification: DocumentClassification | null;
  storage_file_id: string | null;
  failure_reason: string | null;
}

@Injectable()
export class PostgresDocumentRepository implements DocumentRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async save(document: DocumentEntity): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO document_records (
          id,
          source,
          original_file_name,
          content_base64,
          metadata,
          status,
          classification,
          storage_file_id,
          failure_reason
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)
      `,
      [
        document.id,
        document.source,
        document.originalFileName,
        document.contentBase64,
        JSON.stringify(document.metadata),
        document.status,
        JSON.stringify(document.classification),
        document.storageFileId,
        document.failureReason,
      ],
    );
  }

  async update(document: DocumentEntity): Promise<void> {
    await this.pool.query(
      `
        UPDATE document_records
        SET status = $2,
            classification = $3::jsonb,
            storage_file_id = $4,
            failure_reason = $5,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        document.id,
        document.status,
        JSON.stringify(document.classification),
        document.storageFileId,
        document.failureReason,
      ],
    );
  }

  async findById(documentId: string): Promise<DocumentEntity | null> {
    const result = await this.pool.query<DocumentRow>(
      `
        SELECT id,
               source,
               original_file_name,
               content_base64,
               metadata,
               status,
               classification,
               storage_file_id,
               failure_reason
        FROM document_records
        WHERE id = $1
      `,
      [documentId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return this.toEntity(row);
  }

  async findBySourceId(source: DocumentSource, sourceId: string): Promise<DocumentEntity | null> {
    const result = await this.pool.query<DocumentRow>(
      `
        SELECT id,
               source,
               original_file_name,
               content_base64,
               metadata,
               status,
               classification,
               storage_file_id,
               failure_reason
        FROM document_records
        WHERE source = $1
          AND metadata->>'sourceId' = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [source, sourceId],
    );

    const row = result.rows[0];
    return row ? this.toEntity(row) : null;
  }

  async listRecent(limit: number): Promise<DocumentEntity[]> {
    const result = await this.pool.query<DocumentRow>(
      `
        SELECT id,
               source,
               original_file_name,
               content_base64,
               metadata,
               status,
               classification,
               storage_file_id,
               failure_reason
        FROM document_records
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => this.toEntity(row));
  }

  async listDriveRetryCandidates(limit: number, statuses: DocumentStatus[]): Promise<DocumentEntity[]> {
    if (!statuses.length) {
      return [];
    }

    const result = await this.pool.query<DocumentRow>(
      `
        SELECT id,
               source,
               original_file_name,
               content_base64,
               metadata,
               status,
               classification,
               storage_file_id,
               failure_reason
        FROM document_records
        WHERE source = ANY($1)
          AND status = ANY($2)
          AND metadata ? 'googleDriveFileId'
        ORDER BY updated_at ASC
        LIMIT $3
      `,
      [['google-drive', 'google-docs'], statuses, limit],
    );

    return result.rows.map((row) => this.toEntity(row));
  }

  private toEntity(row: DocumentRow): DocumentEntity {
    return new DocumentEntity(
      row.id,
      row.source,
      row.original_file_name,
      row.content_base64,
      row.metadata,
      row.status,
      row.classification,
      row.storage_file_id,
      row.failure_reason,
    );
  }
}
