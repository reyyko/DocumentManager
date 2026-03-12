import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FileSecurityPort } from '../../application/ports/file-security.port';
import { DocumentEntity } from '../../domain/entities/document.entity';

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.scr', '.js', '.ps1'];
const SAFE_MIME_PREFIXES = [
  'application/pdf',
  'image/',
  'text/',
  'application/vnd',
  'application/msword',
  'audio/',
  'video/',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/rar',
];
@Injectable()
export class BasicFileSecurityService implements FileSecurityPort {
  constructor(private readonly configService: ConfigService) {}

  async assertSafe(document: DocumentEntity): Promise<void> {
    const maxFileSizeBytes = this.configService.get<number>('documentManagement.security.maxFileSizeBytes') ?? 75 * 1024 * 1024;
    if (document.metadata.sizeBytes > maxFileSizeBytes) {
      throw new Error(`File too large: ${document.metadata.sizeBytes}`);
    }

    const loweredName = document.originalFileName.toLowerCase();
    if (BLOCKED_EXTENSIONS.some((extension) => loweredName.endsWith(extension))) {
      throw new Error(`Blocked file extension for ${document.originalFileName}`);
    }

    if (!SAFE_MIME_PREFIXES.some((prefix) => document.metadata.mimeType.startsWith(prefix))) {
      throw new Error(`Unsupported mime type ${document.metadata.mimeType}`);
    }

    const raw = Buffer.from(document.contentBase64, 'base64');
    this.assertMagicBytes(document.metadata.mimeType, raw);

    // Basic poison-file guard for local mode. Replace with a real AV engine hook in production.
    const isBinaryMedia =
      document.metadata.mimeType.startsWith('audio/') ||
      document.metadata.mimeType.startsWith('video/') ||
      document.metadata.mimeType === 'application/zip' ||
      document.metadata.mimeType === 'application/x-zip-compressed' ||
      document.metadata.mimeType === 'application/x-rar-compressed' ||
      document.metadata.mimeType === 'application/rar';
    const decoded = isBinaryMedia ? '' : raw.subarray(0, 262144).toString('utf8');
    if (decoded.includes('<script') || decoded.includes('powershell')) {
      throw new Error('Suspicious content detected');
    }
  }

  private assertMagicBytes(mimeType: string, raw: Buffer): void {
    if (!raw.length) {
      throw new Error('Empty file payload');
    }

    if (mimeType === 'application/pdf' && raw.subarray(0, 4).toString('ascii') !== '%PDF') {
      throw new Error('Declared PDF file does not match its binary signature');
    }

    if (mimeType === 'image/png' && raw.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('Declared PNG file does not match its binary signature');
    }

    if (mimeType === 'image/jpeg' && raw.subarray(0, 2).toString('hex') !== 'ffd8') {
      throw new Error('Declared JPEG file does not match its binary signature');
    }

    if (
      mimeType.includes('word') &&
      raw.subarray(0, 2).toString('hex') !== '504b' &&
      raw.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1'
    ) {
      throw new Error('Declared Word document does not match its binary signature');
    }
  }
}
