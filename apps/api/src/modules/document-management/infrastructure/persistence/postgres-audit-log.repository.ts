import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';

import { AuditLogRepository } from '../../domain/repositories/audit-log.repository';
import { PG_POOL } from '../../document-management.tokens';

@Injectable()
export class PostgresAuditLogRepository implements AuditLogRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async append(entry: {
    documentId: string;
    eventType: string;
    actor: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO document_audit_logs (
          id,
          document_id,
          event_type,
          actor,
          payload
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        randomUUID(),
        entry.documentId,
        entry.eventType,
        entry.actor,
        JSON.stringify(entry.payload),
      ],
    );
  }

  async listByDocumentId(documentId: string): Promise<
    Array<{
      documentId: string;
      eventType: string;
      actor: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>
  > {
    const result = await this.pool.query<{
      document_id: string;
      event_type: string;
      actor: string;
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `
        SELECT document_id, event_type, actor, payload, created_at
        FROM document_audit_logs
        WHERE document_id = $1
        ORDER BY created_at ASC
      `,
      [documentId],
    );

    return result.rows.map((row) => ({
      documentId: row.document_id,
      eventType: row.event_type,
      actor: row.actor,
      payload: row.payload,
      createdAt: row.created_at.toISOString(),
    }));
  }
}
