import { SearchDocumentsInput } from '../dto/search-documents.input';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpSearchPort {
  getDefinition(): McpToolDefinition;
  handle(input: SearchDocumentsInput): Promise<Record<string, unknown>>;
}
