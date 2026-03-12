import { z } from 'zod';

import { DOCUMENT_SOURCES } from '../../domain/value-objects/document-source.vo';

export const ingestionMetadataSchema = z.object({
  sourceId: z.string().min(1),
  sourceLabel: z.string().min(1),
  ownerDiscordId: z.string().optional(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  tags: z.array(z.string()).optional(),
  externalReference: z.string().optional(),
  receivedAt: z.string().datetime(),
  signature: z.string().optional(),
  googleDriveFileId: z.string().optional(),
  sourcePath: z.string().optional(),
  sourceModifiedAt: z.string().datetime().optional(),
  driveWebViewLink: z.string().optional(),
  parentFolderIds: z.array(z.string()).optional(),
});

export const ingestDocumentSchema = z.object({
  source: z.enum(DOCUMENT_SOURCES),
  originalFileName: z.string().min(1),
  contentBase64: z.string().min(1),
  metadata: ingestionMetadataSchema,
});

export type IngestDocumentInput = z.infer<typeof ingestDocumentSchema>;
