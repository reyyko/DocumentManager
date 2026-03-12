import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { PG_POOL } from '../../document-management.tokens';

export const postgresPoolProvider: Provider = {
  provide: PG_POOL,
  inject: [ConfigService],
  useFactory: async (configService: ConfigService): Promise<Pool> => {
    const pool = new Pool({
      connectionString: configService.getOrThrow<string>('documentManagement.postgresUrl'),
    });

    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    } catch {
      // Extension creation may require elevated DB privileges; inserts still work because ids are generated in app code.
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS document_records (
          id UUID PRIMARY KEY,
          source TEXT NOT NULL,
          original_file_name TEXT NOT NULL,
          content_base64 TEXT NOT NULL,
          metadata JSONB NOT NULL,
          status TEXT NOT NULL,
          classification JSONB NULL,
          storage_file_id TEXT NULL,
          failure_reason TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS document_audit_logs (
          id UUID PRIMARY KEY,
          document_id UUID NOT NULL,
          event_type TEXT NOT NULL,
          actor TEXT NOT NULL,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_document_records_source_sourceid
        ON document_records (source, ((metadata->>'sourceId')));
      `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS source_connector_state (
          state_key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS drive_file_classification_state (
          google_drive_file_id TEXT PRIMARY KEY,
          document_id UUID NULL,
          status TEXT NOT NULL,
          original_name TEXT NULL,
          standardized_name TEXT NULL,
          source_path TEXT NULL,
          destination_path TEXT NULL,
          category TEXT NULL,
          confidence DOUBLE PRECISION NULL,
          supplier TEXT NULL,
          amount TEXT NULL,
          attention_reason TEXT NULL,
          last_seen_modified_time TIMESTAMPTZ NULL,
          last_processed_at TIMESTAMPTZ NULL,
          classification_payload JSONB NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_drive_file_classification_state_processed_at
        ON drive_file_classification_state (last_processed_at);
      `);

    return pool;
  },
};
