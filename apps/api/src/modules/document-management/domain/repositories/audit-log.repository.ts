export interface AuditLogRepository {
  append(entry: {
    documentId: string;
    eventType: string;
    actor: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  listByDocumentId(documentId: string): Promise<
    Array<{
      documentId: string;
      eventType: string;
      actor: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>
  >;
}
