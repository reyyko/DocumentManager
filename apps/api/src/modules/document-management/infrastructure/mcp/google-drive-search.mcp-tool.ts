import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SearchDocumentsInput } from '../../application/dto/search-documents.input';
import { McpSearchPort, McpToolDefinition } from '../../application/ports/mcp-search.port';
import { SearchDocumentsService } from '../../application/services/search-documents.service';

@Injectable()
export class GoogleDriveSearchMcpTool implements McpSearchPort {
  constructor(
    private readonly configService: ConfigService,
    private readonly searchDocumentsService: SearchDocumentsService,
  ) {}

  getDefinition(): McpToolDefinition {
    const enabled = this.configService.get<boolean>('documentManagement.nativeGoogle.enabled');
    return {
      name: 'google_drive_document_search',
      description: enabled
        ? 'Find company documents in Google Drive from a natural language request and return retrievable files.'
        : 'Disabled. Configure Google OAuth credentials to enable native Google Drive search.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          requesterDiscordId: { type: 'string' },
        },
        required: ['query', 'requesterDiscordId'],
      },
    };
  }

  async handle(input: SearchDocumentsInput): Promise<Record<string, unknown>> {
    if (!this.configService.get<boolean>('documentManagement.nativeGoogle.enabled')) {
      throw new ServiceUnavailableException('Native Google Drive MCP access is disabled. Configure Google OAuth credentials first.');
    }

    const result = await this.searchDocumentsService.execute(input);
    return {
      content: result.results.map((entry) => ({
        type: 'text',
        text: `${entry.name} (${entry.path ?? 'Unknown path'}) fileId=${entry.fileId} download=${entry.downloadPath} ${entry.webViewLink ?? ''}`.trim(),
      })),
      structuredContent: result,
    };
  }
}
