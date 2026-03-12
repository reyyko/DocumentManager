import { DocumentEntity } from '../../domain/entities/document.entity';

export interface ApprovalDecision {
  approved: boolean;
  approverDiscordId: string;
  comment?: string;
}

export interface ApprovalGatePort {
  resolveApprover(document: DocumentEntity): Promise<string>;
}
