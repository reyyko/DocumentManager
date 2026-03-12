import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { DownloadDriveDocumentService } from '../../application/services/download-drive-document.service';
import { IngestDocumentInput } from '../../application/dto/ingest-document.input';
import { SearchDocumentsInput } from '../../application/dto/search-documents.input';
import { ApproveDocumentService } from '../../application/services/approve-document.service';
import { DocumentQueryService } from '../../application/services/document-query.service';
import { IngestDocumentService } from '../../application/services/ingest-document.service';
import { ReprocessDriveDocumentsService } from '../../application/services/reprocess-drive-documents.service';
import { SearchDocumentsService } from '../../application/services/search-documents.service';
import { GoogleDriveSearchMcpTool } from '../../infrastructure/mcp/google-drive-search.mcp-tool';
import { DOCUMENT_STATUSES, DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { DOCUMENT_SOURCES, DocumentSource } from '../../domain/value-objects/document-source.vo';

interface ApprovalRequestBody {
  approved: boolean;
  approverDiscordId: string;
  comment?: string;
}

interface UploadDocumentBody {
  sourceId?: string;
  sourceLabel?: string;
  ownerDiscordId?: string;
  externalReference?: string;
  signature?: string;
  tags?: string | string[];
}

interface SourceWebhookBody {
  originalFileName: string;
  contentBase64?: string;
  fileUrl?: string;
  mimeType?: string;
  sourceId?: string;
  sourceLabel?: string;
  ownerDiscordId?: string;
  externalReference?: string;
  signature?: string;
  tags?: string[];
}

interface ReprocessDriveBody {
  limit?: number;
  statuses?: string[];
}

@Controller('documents')
export class DocumentIngestionController {
  constructor(
    private readonly ingestDocumentService: IngestDocumentService,
    private readonly approveDocumentService: ApproveDocumentService,
    private readonly downloadDriveDocumentService: DownloadDriveDocumentService,
    private readonly searchDocumentsService: SearchDocumentsService,
    private readonly documentQueryService: DocumentQueryService,
    private readonly reprocessDriveDocumentsService: ReprocessDriveDocumentsService,
    private readonly mcpTool: GoogleDriveSearchMcpTool,
  ) {}

  @Post('ingest/:source')
  async ingest(
    @Param('source') source: string,
    @Body() body: Omit<IngestDocumentInput, 'source'>,
  ) {
    return this.ingestDocumentService.execute({
      ...body,
      source: this.assertSource(source),
    });
  }

  @Post('ingest-file/:source')
  @UseInterceptors(FileInterceptor('file'))
  async ingestFile(
    @Param('source') source: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @Body() body: UploadDocumentBody,
  ) {
    const resolvedSource = this.assertSource(source);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Missing uploaded file');
    }

    return this.ingestDocumentService.execute({
      source: resolvedSource,
      originalFileName: file.originalname,
      contentBase64: file.buffer.toString('base64'),
      metadata: {
        sourceId: body.sourceId ?? `${resolvedSource}:${Date.now()}:${file.originalname}`,
        sourceLabel: body.sourceLabel ?? `Upload ${resolvedSource}`,
        ownerDiscordId: body.ownerDiscordId || undefined,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size,
        tags: this.parseTags(body.tags),
        externalReference: body.externalReference || undefined,
        receivedAt: new Date().toISOString(),
        signature: body.signature || undefined,
      },
    });
  }

  @Post('webhook/:source')
  async ingestWebhook(
    @Param('source') source: string,
    @Body() body: SourceWebhookBody,
  ) {
    const resolvedSource = this.assertSource(source);
    const contentBase64 = body.contentBase64 ?? (body.fileUrl ? await this.fetchFileAsBase64(body.fileUrl) : undefined);
    if (!contentBase64) {
      throw new BadRequestException('contentBase64 or fileUrl is required');
    }

    return this.ingestDocumentService.execute({
      source: resolvedSource,
      originalFileName: body.originalFileName,
      contentBase64,
      metadata: {
        sourceId: body.sourceId ?? `${resolvedSource}:${body.externalReference ?? body.originalFileName}`,
        sourceLabel: body.sourceLabel ?? `Webhook ${resolvedSource}`,
        ownerDiscordId: body.ownerDiscordId || undefined,
        mimeType: body.mimeType ?? 'application/octet-stream',
        sizeBytes: Buffer.from(contentBase64, 'base64').byteLength,
        tags: body.tags,
        externalReference: body.externalReference || body.fileUrl,
        receivedAt: new Date().toISOString(),
        signature: body.signature,
      },
    });
  }

  @Post('reprocess-drive')
  async reprocessDrive(@Body() body: ReprocessDriveBody = {}) {
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);
    const statuses = (body.statuses?.length ? body.statuses : ['attention-required', 'failed']).map((status) =>
      this.assertDocumentStatus(status),
    );
    return this.reprocessDriveDocumentsService.execute(limit, statuses);
  }

  @Get()
  async listDocuments(@Query('limit') limit?: string) {
    const max = Math.min(Math.max(Number(limit ?? 20), 1), 100);
    return this.documentQueryService.listRecent(max);
  }

  @Get(':documentId/audit')
  async getAuditTrail(@Param('documentId') documentId: string) {
    return this.documentQueryService.getAuditTrail(documentId);
  }

  @Get(':documentId')
  async getDocument(@Param('documentId') documentId: string) {
    const document = await this.documentQueryService.getDocument(documentId);
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }
    return document;
  }

  @Post(':documentId/approval')
  async approve(
    @Param('documentId') documentId: string,
    @Body() body: ApprovalRequestBody,
  ) {
    await this.approveDocumentService.execute(documentId, body);
    return { documentId, status: body.approved ? 'approved' : 'rejected' };
  }

  @Post('search')
  async search(@Body() body: SearchDocumentsInput) {
    return this.searchDocumentsService.execute(body);
  }

  @Get('drive-files/:fileId/download')
  async downloadDriveFile(
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const file = await this.downloadDriveDocumentService.execute(fileId);
    response.setHeader('Content-Type', file.mimeType ?? 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    return new StreamableFile(Buffer.from(file.contentBase64, 'base64'));
  }

  @Get('mcp/tool')
  getMcpToolDefinition() {
    return this.mcpTool.getDefinition();
  }

  @Post('mcp/tool')
  async handleMcpTool(@Body() body: SearchDocumentsInput) {
    return this.mcpTool.handle(body);
  }

  private assertSource(source: string): DocumentSource {
    if (!DOCUMENT_SOURCES.includes(source as DocumentSource)) {
      throw new BadRequestException(`Unsupported source ${source}`);
    }
    return source as DocumentSource;
  }

  private assertDocumentStatus(status: string): DocumentStatus {
    if (!DOCUMENT_STATUSES.includes(status as DocumentStatus)) {
      throw new BadRequestException(`Unsupported document status ${status}`);
    }
    return status as DocumentStatus;
  }

  private parseTags(tags?: string | string[]): string[] | undefined {
    if (!tags) {
      return undefined;
    }
    if (Array.isArray(tags)) {
      return tags.flatMap((value) => value.split(',').map((part) => part.trim()).filter(Boolean));
    }
    return tags.split(',').map((part) => part.trim()).filter(Boolean);
  }

  private async fetchFileAsBase64(fileUrl: string): Promise<string> {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new BadRequestException(`Unable to download fileUrl: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer()).toString('base64');
  }
}
