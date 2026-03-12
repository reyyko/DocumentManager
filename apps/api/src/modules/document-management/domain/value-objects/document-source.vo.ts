export const DOCUMENT_SOURCES = [
  'gmail',
  'discord-dm',
  'discord-channel',
  'odoo',
  'shopify',
  'google-drive',
  'google-calendar',
  'google-docs',
  'manual',
] as const;

export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export class DocumentSourceValue {
  constructor(public readonly value: DocumentSource) {}

  static create(source: string): DocumentSourceValue {
    if (!DOCUMENT_SOURCES.includes(source as DocumentSource)) {
      throw new Error(`Unsupported document source: ${source}`);
    }

    return new DocumentSourceValue(source as DocumentSource);
  }
}
