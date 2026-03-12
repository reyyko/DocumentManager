export class AuditLogEntity {
  constructor(
    public readonly id: string,
    public readonly documentId: string,
    public readonly eventType: string,
    public readonly actor: string,
    public readonly payload: Record<string, unknown>,
    public readonly createdAt: string,
  ) {}
}
