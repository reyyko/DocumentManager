export type DriveFileProcessingStatus =
  | 'discovered'
  | 'queued'
  | 'processing'
  | 'pending-approval'
  | 'attention-required'
  | 'classified'
  | 'failed';

export interface DriveFileClassificationState {
  googleDriveFileId: string;
  documentId: string | null;
  status: DriveFileProcessingStatus;
  originalName: string | null;
  standardizedName: string | null;
  sourcePath: string | null;
  destinationPath: string | null;
  category: string | null;
  confidence: number | null;
  supplier: string | null;
  amount: string | null;
  attentionReason: string | null;
  lastSeenModifiedTime: string | null;
  lastProcessedAt: string | null;
  classificationPayload: Record<string, unknown> | null;
  updatedAt: string;
}

export interface DriveFileProcessedSummary {
  status: DriveFileProcessingStatus;
  destinationPath: string | null;
  attentionReason: string | null;
  lastProcessedAt: string;
}

export interface DriveFileClassificationStateRepository {
  findByFileId(fileId: string): Promise<DriveFileClassificationState | null>;
  listRetryCandidates(
    limit: number,
    statuses: DriveFileProcessingStatus[],
    onlyWithoutDocument?: boolean,
  ): Promise<DriveFileClassificationState[]>;
  recordDiscovered(input: {
    googleDriveFileId: string;
    originalName: string;
    sourcePath?: string;
    modifiedTime?: string;
    parentFolderIds?: string[];
    webViewLink?: string;
  }): Promise<void>;
  markQueued(input: {
    googleDriveFileId: string;
    documentId: string;
    modifiedTime?: string;
    originalName?: string;
    sourcePath?: string;
  }): Promise<void>;
  markProcessing(fileId: string, documentId?: string): Promise<void>;
  markPendingApproval(input: {
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
  }): Promise<void>;
  markAttentionRequired(input: {
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
  }): Promise<void>;
  markClassified(input: {
    googleDriveFileId: string;
    documentId?: string | null;
    standardizedName: string;
    destinationPath: string;
    category: string;
    confidence: number;
    supplier?: string | null;
    amount?: string | null;
    classificationPayload: Record<string, unknown>;
  }): Promise<void>;
  markFailed(input: {
    googleDriveFileId: string;
    documentId?: string;
    reason: string;
  }): Promise<void>;
  listProcessedForLocalDate(timezone: string, referenceTimeIso: string): Promise<DriveFileProcessedSummary[]>;
}
