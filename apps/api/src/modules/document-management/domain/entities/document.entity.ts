import { randomUUID } from 'crypto';

import { DocumentSource } from '../value-objects/document-source.vo';
import { DocumentStatus } from '../value-objects/document-status.vo';
import { SensitivityLevel } from '../value-objects/sensitivity-level.vo';

export interface DocumentMetadata {
  sourceId: string;
  sourceLabel: string;
  ownerDiscordId?: string;
  mimeType: string;
  sizeBytes: number;
  tags?: string[];
  externalReference?: string;
  receivedAt: string;
  signature?: string;
  googleDriveFileId?: string;
  sourcePath?: string;
  sourceModifiedAt?: string;
  driveWebViewLink?: string;
  parentFolderIds?: string[];
}

export interface DocumentClassification {
  category: string;
  destinationPath: string;
  suggestedName: string;
  confidence: number;
  summary: string;
  extractedFields: Record<string, string | number | boolean | null>;
  sensitivity: SensitivityLevel;
  requiresApproval: boolean;
  reason?: string;
  requiresAttention: boolean;
  attentionReason?: string;
}

export class DocumentEntity {
  constructor(
    public readonly id: string,
    public readonly source: DocumentSource,
    public readonly originalFileName: string,
    public readonly contentBase64: string,
    public readonly metadata: DocumentMetadata,
    public status: DocumentStatus,
    public classification: DocumentClassification | null,
    public storageFileId: string | null,
    public failureReason: string | null,
  ) {}

  static create(params: {
    source: DocumentSource;
    originalFileName: string;
    contentBase64: string;
    metadata: DocumentMetadata;
  }): DocumentEntity {
    return new DocumentEntity(
      randomUUID(),
      params.source,
      params.originalFileName,
      params.contentBase64,
      params.metadata,
      'received',
      null,
      null,
      null,
    );
  }

  markQueued(): void {
    this.status = 'queued';
    this.failureReason = null;
  }

  markProcessing(): void {
    this.status = 'processing';
  }

  markPendingApproval(classification: DocumentClassification): void {
    this.classification = classification;
    this.status = 'pending-approval';
  }

  markAttentionRequired(classification: DocumentClassification, storageFileId: string): void {
    this.classification = classification;
    this.storageFileId = storageFileId;
    this.status = 'attention-required';
  }

  markClassified(classification: DocumentClassification, storageFileId: string): void {
    this.classification = classification;
    this.storageFileId = storageFileId;
    this.status = 'classified';
  }

  markFailed(reason: string): void {
    this.failureReason = reason;
    this.status = 'failed';
  }
}
