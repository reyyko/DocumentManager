import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiAnalysisPort } from '../ports/ai-analysis.port';
import { DriveStoragePort } from '../ports/drive-storage.port';
import { SearchDocumentsInput, searchDocumentsSchema } from '../dto/search-documents.input';
import { AI_ANALYSIS_PORT, DRIVE_STORAGE_PORT } from '../../document-management.tokens';

@Injectable()
export class SearchDocumentsService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(AI_ANALYSIS_PORT) private readonly aiAnalysis: AiAnalysisPort,
    @Inject(DRIVE_STORAGE_PORT) private readonly driveStorage: DriveStoragePort,
  ) {}

  async execute(input: SearchDocumentsInput) {
    if (!this.configService.get<boolean>('documentManagement.nativeGoogle.enabled')) {
      throw new ServiceUnavailableException('Native Google Drive search is disabled. Use the Maton Google Drive skill.');
    }

    const payload = searchDocumentsSchema.parse(input);
    const plan = await this.aiAnalysis.buildSearchPlan(payload);
    const results = await this.driveStorage.searchDocuments(plan);

    return {
      query: payload.query,
      results: results.map((result) => ({
        ...result,
        downloadPath: `/documents/drive-files/${result.fileId}/download`,
      })),
    };
  }
}
