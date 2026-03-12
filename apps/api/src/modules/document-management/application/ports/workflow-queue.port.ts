export interface WorkflowQueuePort {
  enqueueDocumentAnalysis(documentId: string): Promise<void>;
}
