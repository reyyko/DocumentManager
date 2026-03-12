import { DocumentEntity } from '../../domain/entities/document.entity';
import { DocumentAnalysisResultDto } from '../dto/document-analysis-result.dto';
import { SearchDocumentsInput } from '../dto/search-documents.input';

export interface SearchPlan {
  keywords: string[];
  folderHint?: string;
  mimeTypes?: string[];
}

export interface AiAnalysisPort {
  analyze(document: DocumentEntity): Promise<DocumentAnalysisResultDto>;
  buildSearchPlan(input: SearchDocumentsInput): Promise<SearchPlan>;
}
