import { createHmac, timingSafeEqual } from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RequestSignaturePort } from '../../application/ports/request-signature.port';
import { IngestDocumentInput } from '../../application/dto/ingest-document.input';

@Injectable()
export class RequestSignatureService implements RequestSignaturePort {
  constructor(private readonly configService: ConfigService) {}

  async assertIntegrity(payload: IngestDocumentInput): Promise<void> {
    const sharedSecret = this.configService.get<string>('documentManagement.ingestionSharedSecret');
    const providedSignature = payload.metadata.signature;

    if (!sharedSecret || !providedSignature) {
      return;
    }

    const signer = createHmac('sha256', sharedSecret);
    signer.update(`${payload.source}:${payload.originalFileName}:${payload.metadata.sourceId}:${payload.metadata.receivedAt}`);
    const expectedSignature = signer.digest('hex');

    const provided = Buffer.from(providedSignature, 'hex');
    const expected = Buffer.from(expectedSignature, 'hex');

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new Error('Invalid ingestion signature');
    }
  }
}
