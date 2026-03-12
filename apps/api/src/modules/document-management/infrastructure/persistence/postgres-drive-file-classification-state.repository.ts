import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import {
  DriveFileClassificationState,
  DriveFileClassificationStateRepository,
  DriveFileProcessedSummary,
} from '../../domain/repositories/drive-file-classification-state.repository';
import { PG_POOL } from '../../document-management.tokens';

interface DriveFileStateRow {
  google_drive_file_id: string;
  document_id: string | null;
  status: DriveFileClassificationState['status'];
  original_name: string | null;
  standardized_name: string | null;
  source_path: string | null;
  destination_path: string | null;
  category: string | null;
  confidence: number | null;
  supplier: string | null;
  amount: string | null;
  attention_reason: string | null;
  last_seen_modified_time: Date | null;
  last_processed_at: Date | null;
  classification_payload: Record<string, unknown> | null;
  updated_at: Date;
}

@Injectable()
export class PostgresDriveFileClassificationStateRepository implements DriveFileClassificationStateRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByFileId(fileId: string): Promise<DriveFileClassificationState | null> {
    const result = await this.pool.query<DriveFileStateRow>(
      `
        SELECT google_drive_file_id,
               document_id,
               status,
               original_name,
               standardized_name,
               source_path,
               destination_path,
               category,
               confidence,
               supplier,
               amount,
               attention_reason,
               last_seen_modified_time,
               last_processed_at,
               classification_payload,
               updated_at
        FROM drive_file_classification_state
        WHERE google_drive_file_id = $1
      `,
      [fileId],
    );

    const row = result.rows[0];
    return row ? this.toState(row) : null;
  }

  async listRetryCandidates(
    limit: number,
    statuses: DriveFileClassificationState['status'][],
    onlyWithoutDocument = false,
  ): Promise<DriveFileClassificationState[]> {
    if (!statuses.length || limit <= 0) {
      return [];
    }

    const result = await this.pool.query<DriveFileStateRow>(
      `
        SELECT google_drive_file_id,
               document_id,
               status,
               original_name,
               standardized_name,
               source_path,
               destination_path,
               category,
               confidence,
               supplier,
               amount,
               attention_reason,
               last_seen_modified_time,
               last_processed_at,
               classification_payload,
               updated_at
        FROM drive_file_classification_state
        WHERE status = ANY($1::text[])
          AND ($3::boolean = false OR document_id IS NULL)
        ORDER BY updated_at ASC
        LIMIT $2
      `,
      [statuses, limit, onlyWithoutDocument],
    );

    return result.rows.map((row) => this.toState(row));
  }

  async recordDiscovered(input: {
    googleDriveFileId: string;
    originalName: string;
    sourcePath?: string;
    modifiedTime?: string;
    parentFolderIds?: string[];
    webViewLink?: string;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO drive_file_classification_state (
          google_drive_file_id,
          status,
          original_name,
          source_path,
          last_seen_modified_time,
          classification_payload,
          updated_at
        ) VALUES ($1, 'discovered', $2, $3, $4, $5::jsonb, NOW())
        ON CONFLICT (google_drive_file_id)
        DO UPDATE SET original_name = EXCLUDED.original_name,
                      source_path = EXCLUDED.source_path,
                      last_seen_modified_time = EXCLUDED.last_seen_modified_time,
                      classification_payload = COALESCE(drive_file_classification_state.classification_payload, '{}'::jsonb) || EXCLUDED.classification_payload,
                      updated_at = NOW()
      `,
      [
        input.googleDriveFileId,
        input.originalName,
        input.sourcePath ?? null,
        input.modifiedTime ?? null,
        JSON.stringify({
          parentFolderIds: input.parentFolderIds ?? [],
          webViewLink: input.webViewLink ?? null,
        }),
      ],
    );
  }

  async markQueued(input: {
    googleDriveFileId: string;
    documentId: string;
    modifiedTime?: string;
    originalName?: string;
    sourcePath?: string;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO drive_file_classification_state (
          google_drive_file_id,
          document_id,
          status,
          original_name,
          source_path,
          last_seen_modified_time,
          updated_at
        ) VALUES ($1, $2, 'queued', $3, $4, $5, NOW())
        ON CONFLICT (google_drive_file_id)
        DO UPDATE SET document_id = EXCLUDED.document_id,
                      status = 'queued',
                      original_name = COALESCE(EXCLUDED.original_name, drive_file_classification_state.original_name),
                      source_path = COALESCE(EXCLUDED.source_path, drive_file_classification_state.source_path),
                      last_seen_modified_time = COALESCE(EXCLUDED.last_seen_modified_time, drive_file_classification_state.last_seen_modified_time),
                      updated_at = NOW()
      `,
      [
        input.googleDriveFileId,
        input.documentId,
        input.originalName ?? null,
        input.sourcePath ?? null,
        input.modifiedTime ?? null,
      ],
    );
  }

  async markProcessing(fileId: string, documentId?: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE drive_file_classification_state
        SET status = 'processing',
            document_id = COALESCE($2, document_id),
            updated_at = NOW()
        WHERE google_drive_file_id = $1
      `,
      [fileId, documentId ?? null],
    );
  }

  async markPendingApproval(input: {
    googleDriveFileId: string;
    documentId: string;
    standardizedName: string;
    destinationPath: string;
    category: string;
    confidence: number;
    supplier?: string | null;
    amount?: string | null;
    attentionReason?: string;
    classificationPayload: Record<string, unknown>;
  }): Promise<void> {
    await this.updateTerminalState('pending-approval', input, input.attentionReason ?? null);
  }

  async markAttentionRequired(input: {
    googleDriveFileId: string;
    documentId: string;
    standardizedName: string;
    destinationPath: string;
    category: string;
    confidence: number;
    supplier?: string | null;
    amount?: string | null;
    attentionReason: string;
    classificationPayload: Record<string, unknown>;
  }): Promise<void> {
    await this.updateTerminalState('attention-required', input, input.attentionReason);
  }

  async markClassified(input: {
    googleDriveFileId: string;
    documentId?: string | null;
    standardizedName: string;
    destinationPath: string;
    category: string;
    confidence: number;
    supplier?: string | null;
    amount?: string | null;
    classificationPayload: Record<string, unknown>;
  }): Promise<void> {
    await this.updateTerminalState('classified', input, null);
  }

  async markFailed(input: {
    googleDriveFileId: string;
    documentId?: string;
    reason: string;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO drive_file_classification_state (
          google_drive_file_id,
          document_id,
          status,
          attention_reason,
          last_processed_at,
          updated_at
        ) VALUES ($1, $2, 'failed', $3, NOW(), NOW())
        ON CONFLICT (google_drive_file_id)
        DO UPDATE SET document_id = COALESCE(EXCLUDED.document_id, drive_file_classification_state.document_id),
                      status = 'failed',
                      attention_reason = EXCLUDED.attention_reason,
                      last_processed_at = NOW(),
                      updated_at = NOW()
      `,
      [input.googleDriveFileId, input.documentId ?? null, input.reason],
    );
  }

  async listProcessedForLocalDate(timezone: string, referenceTimeIso: string): Promise<DriveFileProcessedSummary[]> {
    const result = await this.pool.query<{
      status: DriveFileProcessedSummary['status'];
      destination_path: string | null;
      attention_reason: string | null;
      last_processed_at: Date;
    }>(
      `
        SELECT status, destination_path, attention_reason, last_processed_at
        FROM drive_file_classification_state
        WHERE last_processed_at IS NOT NULL
          AND (last_processed_at AT TIME ZONE $1)::date = (($2::timestamptz) AT TIME ZONE $1)::date
      `,
      [timezone, referenceTimeIso],
    );

    return result.rows.map((row) => ({
      status: row.status,
      destinationPath: row.destination_path,
      attentionReason: row.attention_reason,
      lastProcessedAt: row.last_processed_at.toISOString(),
    }));
  }

  private async updateTerminalState(
    status: 'pending-approval' | 'attention-required' | 'classified',
    input: {
      googleDriveFileId: string;
      documentId?: string | null;
      standardizedName: string;
      destinationPath: string;
      category: string;
      confidence: number;
      supplier?: string | null;
      amount?: string | null;
      classificationPayload: Record<string, unknown>;
    },
    attentionReason: string | null,
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO drive_file_classification_state (
          google_drive_file_id,
          document_id,
          status,
          standardized_name,
          destination_path,
          category,
          confidence,
          supplier,
          amount,
          attention_reason,
          classification_payload,
          last_processed_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW())
        ON CONFLICT (google_drive_file_id)
        DO UPDATE SET document_id = EXCLUDED.document_id,
                      status = EXCLUDED.status,
                      standardized_name = EXCLUDED.standardized_name,
                      destination_path = EXCLUDED.destination_path,
                      category = EXCLUDED.category,
                      confidence = EXCLUDED.confidence,
                      supplier = EXCLUDED.supplier,
                      amount = EXCLUDED.amount,
                      attention_reason = EXCLUDED.attention_reason,
                      classification_payload = EXCLUDED.classification_payload,
                      last_processed_at = NOW(),
                      updated_at = NOW()
      `,
      [
        input.googleDriveFileId,
        input.documentId ?? null,
        status,
        input.standardizedName,
        input.destinationPath,
        input.category,
        input.confidence,
        input.supplier ?? null,
        input.amount ?? null,
        attentionReason,
        JSON.stringify(input.classificationPayload),
      ],
    );
  }

  private toState(row: DriveFileStateRow): DriveFileClassificationState {
    return {
      googleDriveFileId: row.google_drive_file_id,
      documentId: row.document_id,
      status: row.status,
      originalName: row.original_name,
      standardizedName: row.standardized_name,
      sourcePath: row.source_path,
      destinationPath: row.destination_path,
      category: row.category,
      confidence: row.confidence,
      supplier: row.supplier,
      amount: row.amount,
      attentionReason: row.attention_reason,
      lastSeenModifiedTime: row.last_seen_modified_time?.toISOString() ?? null,
      lastProcessedAt: row.last_processed_at?.toISOString() ?? null,
      classificationPayload: row.classification_payload,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
