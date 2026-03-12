import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApprovalGatePort } from '../../application/ports/approval-gate.port';
import { DocumentEntity } from '../../domain/entities/document.entity';

@Injectable()
export class DefaultApprovalGateService implements ApprovalGatePort {
  constructor(private readonly configService: ConfigService) {}

  async resolveApprover(document: DocumentEntity): Promise<string> {
    return document.metadata.ownerDiscordId
      ?? this.configService.get<string>('documentManagement.defaultApproverDiscordId')
      ?? '';
  }
}
