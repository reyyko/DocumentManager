export interface DiscordNotificationPort {
  notifyQueue(documentName: string, source: string): Promise<void>;
  notifyClassification(params: {
    documentId: string;
    destinationPath: string;
    target: 'finance' | 'logistics' | 'contracts' | 'general';
    summary: string;
  }): Promise<void>;
  notifyApprovalRequired(params: {
    documentId: string;
    approverDiscordId: string;
    reason: string;
    documentName: string;
  }): Promise<void>;
  notifyAttentionRequired(params: {
    documentId: string;
    documentName: string;
    reason: string;
    destinationPath: string;
  }): Promise<void>;
  notifyDriveDailyReport(message: string): Promise<void>;
}
