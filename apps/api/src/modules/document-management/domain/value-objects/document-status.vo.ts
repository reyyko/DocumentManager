export const DOCUMENT_STATUSES = [
  'received',
  'queued',
  'processing',
  'pending-approval',
  'attention-required',
  'classified',
  'failed',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
