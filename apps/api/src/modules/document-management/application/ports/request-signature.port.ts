import { IngestDocumentInput } from '../dto/ingest-document.input';

export interface RequestSignaturePort {
  assertIntegrity(payload: IngestDocumentInput): Promise<void>;
}
