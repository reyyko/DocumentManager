import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { Pool } from 'pg';
import { mkdir, readFile, rename, stat } from 'fs/promises';
import { basename, extname, resolve } from 'path';
import { readdir } from 'fs/promises';

import { IngestDocumentService } from '../../application/services/ingest-document.service';
import { PG_POOL } from '../../document-management.tokens';
import { DocumentSource } from '../../domain/value-objects/document-source.vo';

type ConnectorStateValue = Record<string, unknown>;

@Injectable()
export class SourceConnectorsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SourceConnectorsService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly ingestDocumentService: IngestDocumentService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(resolve(this.configService.get<string>('documentManagement.storage.manualDepotDir') ?? 'data/manual-depot'), {
      recursive: true,
    });
    await mkdir(resolve(this.configService.get<string>('documentManagement.storage.processedDepotDir') ?? 'data/processed'), {
      recursive: true,
    });

    const pollIntervalMs = this.configService.get<number>('documentManagement.connectors.pollIntervalMs') ?? 30000;
    this.timer = setInterval(() => {
      void this.pollAll();
    }, pollIntervalMs);
    void this.pollAll();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async pollAll(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.runConnector('manual-depot', () => this.pollManualDepot());
      await this.runConnector('discord', () => this.pollDiscordChannels());
      if (this.configService.get<boolean>('documentManagement.nativeGoogle.enabled')) {
        await this.runConnector('gmail', () => this.pollGmail());
      }
      if (
        this.configService.get<boolean>('documentManagement.nativeGoogle.enabled') &&
        !this.configService.get<boolean>('documentManagement.driveCrawler.enabled')
      ) {
        await this.runConnector('google-drive', () => this.pollGoogleDriveFolders());
      }
    } finally {
      this.running = false;
    }
  }

  private async pollManualDepot(): Promise<void> {
    const manualDepotDir = resolve(this.configService.get<string>('documentManagement.storage.manualDepotDir') ?? 'data/manual-depot');
    const processedDepotDir = resolve(this.configService.get<string>('documentManagement.storage.processedDepotDir') ?? 'data/processed');
    const entries = await readdir(manualDepotDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const filePath = resolve(manualDepotDir, entry.name);
      const fileStat = await stat(filePath);
      const buffer = await readFile(filePath);
      const sourceId = `manual:${entry.name}:${fileStat.mtimeMs}`;

      await this.safeIngest({
        source: 'manual',
        sourceId,
        sourceLabel: 'Dépôt manuel',
        originalFileName: entry.name,
        buffer,
        mimeType: this.resolveMimeType(entry.name, buffer),
        ownerDiscordId: undefined,
        externalReference: filePath,
      });

      const targetPath = resolve(processedDepotDir, `${Date.now()}-${entry.name}`);
      await rename(filePath, targetPath);
    }
  }

  private async pollDiscordChannels(): Promise<void> {
    const token = this.configService.get<string>('documentManagement.discord.token');
    const channelIds = this.configService.get<string[]>('documentManagement.connectors.discordChannelIds') ?? [];
    if (!token || !channelIds.length) {
      return;
    }

    for (const channelId of channelIds) {
      const stateKey = `discord:${channelId}:lastMessageId`;
      const lastMessageId = String((await this.getState(stateKey))?.value ?? '0');
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=25`, {
        headers: {
          Authorization: `Bot ${token}`,
        },
      });
      if (!response.ok) {
        this.logger.warn(`Discord ingest poll failed for channel ${channelId}: ${response.status}`);
        continue;
      }

      const messages = ((await response.json()) as Array<Record<string, unknown>>)
        .filter((message) => BigInt(String(message.id)) > BigInt(lastMessageId))
        .sort((a, b) => (BigInt(String(a.id)) > BigInt(String(b.id)) ? 1 : -1));

      let maxId = lastMessageId;
      for (const message of messages) {
        const attachments = Array.isArray(message.attachments) ? (message.attachments as Array<Record<string, unknown>>) : [];
        for (const attachment of attachments) {
          const url = String(attachment.url ?? '');
          if (!url) {
            continue;
          }
          const buffer = Buffer.from(await (await fetch(url)).arrayBuffer());
          await this.safeIngest({
            source: 'discord-channel',
            sourceId: `discord:${channelId}:${message.id}:${attachment.id}`,
            sourceLabel: `Discord ${channelId}`,
            originalFileName: String(attachment.filename ?? `discord-${attachment.id}`),
            buffer,
            mimeType: String(attachment.content_type ?? this.resolveMimeType(String(attachment.filename ?? 'document.bin'), buffer)),
            ownerDiscordId: String((message.author as Record<string, unknown> | undefined)?.id ?? ''),
            externalReference: String(message.id),
          });
        }
        maxId = String(message.id);
      }

      if (maxId !== lastMessageId) {
        await this.setState(stateKey, { value: maxId });
      }
    }
  }

  private async pollGmail(): Promise<void> {
    if (!this.configService.get<boolean>('documentManagement.connectors.gmailEnabled')) {
      return;
    }

    const auth = this.createGoogleAuth();
    if (!auth) {
      return;
    }

    const gmail = google.gmail({ version: 'v1', auth });
    const query = this.configService.get<string>('documentManagement.connectors.gmailQuery') ?? 'has:attachment is:unread';
    const listing = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10,
    });

    for (const message of listing.data.messages ?? []) {
      if (!message.id) {
        continue;
      }

      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full',
      });

      const gmailContext = this.extractGmailMessageContext(fullMessage.data.payload as unknown as Record<string, unknown> | undefined);
      const attachments = this.collectGmailAttachments(fullMessage.data.payload as unknown as Record<string, unknown> | undefined);
      for (const attachment of attachments) {
        const skipReason = this.getGmailSkipReason(attachment, gmailContext);
        if (skipReason) {
          this.logger.log(`Skipped Gmail attachment ${attachment.filename || 'unnamed'} from message ${message.id}: ${skipReason}`);
          continue;
        }

        const buffer = attachment.data
          ? Buffer.from(attachment.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
          : await this.fetchGmailAttachment(gmail, message.id, attachment.attachmentId!);

        await this.safeIngest({
          source: 'gmail',
          sourceId: `gmail:${message.id}:${attachment.attachmentId ?? attachment.filename}`,
          sourceLabel: 'Gmail',
          originalFileName: attachment.filename || `gmail-${message.id}`,
          buffer,
          mimeType: this.resolveMimeType(attachment.filename || 'document.bin', buffer, attachment.mimeType || undefined),
          ownerDiscordId: undefined,
          externalReference: message.id,
        });
      }

      await gmail.users.messages.modify({
        userId: 'me',
        id: message.id,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });
    }
  }

  private async pollGoogleDriveFolders(): Promise<void> {
    const folderIds = this.configService.get<string[]>('documentManagement.connectors.googleDriveFolderIds') ?? [];
    if (!folderIds.length) {
      return;
    }

    const auth = this.createGoogleAuth();
    if (!auth) {
      return;
    }

    const drive = google.drive({ version: 'v3', auth });
    for (const folderId of folderIds) {
      const stateKey = `gdrive:${folderId}:processed`;
      const state = (await this.getState(stateKey))?.processedIds;
      const processedIds = new Set(Array.isArray(state) ? (state as string[]) : []);

      const files = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))',
        pageSize: 50,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const newProcessedIds = [...processedIds];
      for (const file of files.data.files ?? []) {
        if (!file.id || processedIds.has(file.id)) {
          continue;
        }

        const download = await this.downloadDriveFile(drive, file.id, file.mimeType ?? 'application/octet-stream');
        await this.safeIngest({
          source: file.mimeType?.startsWith('application/vnd.google-apps.document') ? 'google-docs' : 'google-drive',
          sourceId: `gdrive:${file.id}`,
          sourceLabel: `Google Drive ${folderId}`,
          originalFileName: file.name ?? file.id,
          buffer: download.buffer,
          mimeType: download.mimeType,
          ownerDiscordId: undefined,
          externalReference: file.webViewLink ?? file.id,
        });
        newProcessedIds.push(file.id);
      }

      await this.setState(stateKey, {
        processedIds: newProcessedIds.slice(-500),
      });
    }
  }

  private async ingestBuffer(params: {
    source: DocumentSource;
    sourceId: string;
    sourceLabel: string;
    originalFileName: string;
    buffer: Buffer;
    mimeType: string;
    ownerDiscordId?: string;
    externalReference?: string;
  }): Promise<void> {
    await this.ingestDocumentService.execute({
      source: params.source,
      originalFileName: params.originalFileName,
      contentBase64: params.buffer.toString('base64'),
      metadata: {
        sourceId: params.sourceId,
        sourceLabel: params.sourceLabel,
        ownerDiscordId: params.ownerDiscordId || undefined,
        mimeType: params.mimeType,
        sizeBytes: params.buffer.byteLength,
        externalReference: params.externalReference,
        receivedAt: new Date().toISOString(),
      },
    });
  }

  private async safeIngest(params: {
    source: DocumentSource;
    sourceId: string;
    sourceLabel: string;
    originalFileName: string;
    buffer: Buffer;
    mimeType: string;
    ownerDiscordId?: string;
    externalReference?: string;
  }): Promise<void> {
    try {
      await this.ingestBuffer(params);
    } catch (error) {
      this.logger.error(
        `Failed to ingest ${params.source}:${params.sourceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private resolveMimeType(fileName: string, buffer?: Buffer, preferredMimeType?: string): string {
    if (preferredMimeType && preferredMimeType !== 'application/octet-stream') {
      return preferredMimeType;
    }

    const detected = this.detectMimeTypeFromBuffer(buffer);
    if (detected) {
      return detected;
    }

    const suffix = extname(fileName).toLowerCase();
    if (suffix === '.pdf') {
      return 'application/pdf';
    }
    if (suffix === '.png') {
      return 'image/png';
    }
    if (suffix === '.jpg' || suffix === '.jpeg') {
      return 'image/jpeg';
    }
    if (suffix === '.docx') {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (suffix === '.doc') {
      return 'application/msword';
    }
    if (suffix === '.csv') {
      return 'text/csv';
    }
    if (suffix === '.txt' || suffix === '.md') {
      return 'text/plain';
    }
    return 'application/octet-stream';
  }

  private detectMimeTypeFromBuffer(buffer?: Buffer): string | null {
    if (!buffer || !buffer.length) {
      return null;
    }

    if (buffer.subarray(0, 4).toString('ascii') === '%PDF') {
      return 'application/pdf';
    }
    if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
      return 'image/png';
    }
    if (buffer.subarray(0, 2).toString('hex') === 'ffd8') {
      return 'image/jpeg';
    }
    if (buffer.subarray(0, 2).toString('hex') === '504b') {
      return 'application/zip';
    }
    const textSample = buffer.subarray(0, 512).toString('utf8');
    if (textSample.trim() && !textSample.includes('\u0000')) {
      return 'text/plain';
    }
    return null;
  }

  private async runConnector(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(
        `Connector ${name} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private createGoogleAuth() {
    const clientId = this.configService.get<string>('documentManagement.googleDrive.clientId');
    const clientSecret = this.configService.get<string>('documentManagement.googleDrive.clientSecret');
    const refreshToken = this.configService.get<string>('documentManagement.googleDrive.refreshToken');
    const redirectUri = this.configService.get<string>('documentManagement.googleDrive.redirectUri');

    if (!clientId || !clientSecret || !refreshToken || !redirectUri) {
      return null;
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials({ refresh_token: refreshToken });
    return auth;
  }

  private collectGmailAttachments(payload: Record<string, unknown> | undefined): Array<{
    filename?: string;
    attachmentId?: string;
    mimeType?: string;
    data?: string;
    sizeBytes?: number;
    contentDisposition?: string;
    contentId?: string;
  }> {
    if (!payload) {
      return [];
    }

    const attachments: Array<{
      filename?: string;
      attachmentId?: string;
      mimeType?: string;
      data?: string;
      sizeBytes?: number;
      contentDisposition?: string;
      contentId?: string;
    }> = [];
    const visit = (part: Record<string, unknown>) => {
      const filename = String(part.filename ?? '');
      const body = (part.body as Record<string, unknown> | undefined) ?? {};
      const headers = Array.isArray(part.headers) ? (part.headers as Array<Record<string, unknown>>) : [];
      if (filename) {
        attachments.push({
          filename,
          attachmentId: typeof body.attachmentId === 'string' ? body.attachmentId : undefined,
          mimeType: typeof part.mimeType === 'string' ? part.mimeType : undefined,
          data: typeof body.data === 'string' ? body.data : undefined,
          sizeBytes: typeof body.size === 'number' ? body.size : undefined,
          contentDisposition: this.findHeader(headers, 'Content-Disposition'),
          contentId: this.findHeader(headers, 'Content-ID'),
        });
      }

      const nestedParts = Array.isArray(part.parts) ? (part.parts as Array<Record<string, unknown>>) : [];
      for (const nested of nestedParts) {
        visit(nested);
      }
    };

    visit(payload);
    return attachments;
  }

  private extractGmailMessageContext(payload: Record<string, unknown> | undefined): { subject: string; from: string } {
    const headers = Array.isArray(payload?.headers) ? (payload.headers as Array<Record<string, unknown>>) : [];
    return {
      subject: this.findHeader(headers, 'Subject') ?? '',
      from: this.findHeader(headers, 'From') ?? '',
    };
  }

  private findHeader(headers: Array<Record<string, unknown>>, name: string): string | undefined {
    const match = headers.find((header) => String(header.name ?? '').toLowerCase() === name.toLowerCase());
    return typeof match?.value === 'string' ? match.value : undefined;
  }

  private getGmailSkipReason(
    attachment: {
      filename?: string;
      mimeType?: string;
      sizeBytes?: number;
      contentDisposition?: string;
      contentId?: string;
    },
    context: { subject: string; from: string },
  ): string | null {
    const fileName = String(attachment.filename ?? '').toLowerCase();
    const mimeType = String(attachment.mimeType ?? '').toLowerCase();
    const contentDisposition = String(attachment.contentDisposition ?? '').toLowerCase();
    const subject = context.subject.toLowerCase();
    const from = context.from.toLowerCase();
    const sizeBytes = attachment.sizeBytes ?? 0;

    if (!fileName) {
      return 'missing filename';
    }

    const decorativePatterns = [
      'logo',
      'icon',
      'banner',
      'button',
      'border-image',
      'content-image',
      'body-validation',
      'header',
      'footer',
      'spacer',
      'pixel',
      'tracker',
      'tracking',
      'visit.gif',
      'post.gif',
      '@dist/img/',
      '/img/',
    ];
    if (decorativePatterns.some((pattern) => fileName.includes(pattern))) {
      return 'decorative inline asset';
    }

    const legalBoilerplatePatterns = [
      'eula',
      'terms_of_use',
      'terms-of-use',
      'terms of use',
      'privacy_policy',
      'privacy-policy',
      'privacy policy',
      'cookie_policy',
      'cookie-policy',
      'cookie policy',
    ];
    if (legalBoilerplatePatterns.some((pattern) => fileName.includes(pattern))) {
      return 'generic legal boilerplate';
    }

    if (contentDisposition.includes('inline') || attachment.contentId) {
      return 'inline attachment';
    }

    if (mimeType.startsWith('image/')) {
      const dimensions = fileName.match(/(\d{1,4})x(\d{1,4})/);
      if (dimensions) {
        const width = Number(dimensions[1]);
        const height = Number(dimensions[2]);
        if (width <= 200 || height <= 200 || width * height <= 120000) {
          return 'small inline image';
        }
      }

      if (sizeBytes > 0 && sizeBytes < 32_000) {
        return 'small image attachment';
      }
    }

    const noisySenders = ['no-reply', 'noreply', 'newsletter', 'marketing'];
    if (
      legalBoilerplatePatterns.some((pattern) => subject.includes(pattern)) &&
      noisySenders.some((sender) => from.includes(sender))
    ) {
      return 'newsletter legal bundle';
    }

    return null;
  }

  private async fetchGmailAttachment(
    gmail: ReturnType<typeof google.gmail>,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });
    const data = response.data.data ?? '';
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }

  private async downloadDriveFile(
    drive: ReturnType<typeof google.drive>,
    fileId: string,
    mimeType: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (mimeType === 'application/vnd.google-apps.document') {
      const exportResponse = await drive.files.export(
        {
          fileId,
          mimeType: 'application/pdf',
        },
        {
          responseType: 'arraybuffer',
        },
      );
      return {
        buffer: Buffer.from(exportResponse.data as ArrayBuffer),
        mimeType: 'application/pdf',
      };
    }

    const response = await drive.files.get(
      {
        fileId,
        alt: 'media',
      },
      {
        responseType: 'arraybuffer',
      },
    );

    return {
      buffer: Buffer.from(response.data as ArrayBuffer),
      mimeType,
    };
  }

  private async getState(stateKey: string): Promise<ConnectorStateValue | null> {
    const result = await this.pool.query<{ value: ConnectorStateValue }>(
      'SELECT value FROM source_connector_state WHERE state_key = $1',
      [stateKey],
    );
    return result.rows[0]?.value ?? null;
  }

  private async setState(stateKey: string, value: ConnectorStateValue): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO source_connector_state (state_key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (state_key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `,
      [stateKey, JSON.stringify(value)],
    );
  }
}
