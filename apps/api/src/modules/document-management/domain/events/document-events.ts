export class DocumentQueuedEvent {
  constructor(
    public readonly documentId: string,
    public readonly source: string,
  ) {}
}

export class DocumentClassifiedEvent {
  constructor(
    public readonly documentId: string,
    public readonly destinationPath: string,
  ) {}
}

export class DocumentApprovalRequestedEvent {
  constructor(
    public readonly documentId: string,
    public readonly approverDiscordId: string,
  ) {}
}
