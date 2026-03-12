import { SearchPlan } from './ai-analysis.port';

export interface ClassifiedDocumentPayload {
  fileName: string;
  folderPath: string;
  mimeType: string;
  contentBase64: string;
}

export interface ExistingDriveClassificationPayload {
  fileId: string;
  fileName: string;
  folderPath: string;
}

export interface DriveSearchResult {
  fileId: string;
  name: string;
  webViewLink?: string;
  mimeType?: string;
  modifiedTime?: string;
  path?: string;
}

export interface DriveScanCandidate extends DriveSearchResult {
  parentIds: string[];
}

export interface DownloadedDriveFile extends DriveScanCandidate {
  contentBase64: string;
  sizeBytes: number;
}

export interface DriveStoragePort {
  storeDocument(payload: ClassifiedDocumentPayload): Promise<string>;
  classifyExistingDocument(payload: ExistingDriveClassificationPayload): Promise<string>;
  ensureFolderLoop(folderPath: string): Promise<void>;
  scanFolders(folderIds: string[], limit: number): Promise<DriveScanCandidate[]>;
  downloadFile(fileId: string): Promise<DownloadedDriveFile | null>;
  searchDocuments(plan: SearchPlan): Promise<DriveSearchResult[]>;
}
