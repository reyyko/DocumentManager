import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { AnalyzeDocumentService } from './application/services/analyze-document.service';
import { ApproveDocumentService } from './application/services/approve-document.service';
import { DownloadDriveDocumentService } from './application/services/download-drive-document.service';
import { DocumentQueryService } from './application/services/document-query.service';
import { DriveCrawlerService } from './application/services/drive-crawler.service';
import { DriveDailyReportService } from './application/services/drive-daily-report.service';
import { IngestDocumentService } from './application/services/ingest-document.service';
import { ReprocessDriveDocumentsService } from './application/services/reprocess-drive-documents.service';
import { SearchDocumentsService } from './application/services/search-documents.service';
import {
  AI_ANALYSIS_PORT,
  APPROVAL_GATE_PORT,
  AUDIT_LOG_REPOSITORY,
  DISCORD_NOTIFICATION_PORT,
  DRIVE_CLASSIFICATION_STATE_REPOSITORY,
  DOCUMENT_QUEUE,
  DOCUMENT_REPOSITORY,
  DRIVE_STORAGE_PORT,
  FILE_SECURITY_PORT,
  MCP_SEARCH_PORT,
  REQUEST_SIGNATURE_PORT,
} from './document-management.tokens';
import { DocumentAnalysisProcessor } from './infrastructure/bullmq/document-analysis.processor';
import { DriveCrawlerProcessor } from './infrastructure/bullmq/drive-crawler.processor';
import { DriveCrawlerSchedulerService } from './infrastructure/bullmq/drive-crawler-scheduler.service';
import { DocumentQueueService } from './infrastructure/bullmq/document-queue.service';
import { DiscordVdManagerService } from './infrastructure/discord/discord-vd-manager.service';
import { SourceConnectorsService } from './infrastructure/connectors/source-connectors.service';
import { GoogleDriveService } from './infrastructure/google-drive/google-drive.service';
import { GoogleDriveSearchMcpTool } from './infrastructure/mcp/google-drive-search.mcp-tool';
import { PostgresAuditLogRepository } from './infrastructure/persistence/postgres-audit-log.repository';
import { PostgresDocumentRepository } from './infrastructure/persistence/postgres-document.repository';
import { PostgresDriveFileClassificationStateRepository } from './infrastructure/persistence/postgres-drive-file-classification-state.repository';
import { postgresPoolProvider } from './infrastructure/persistence/postgres.providers';
import { OpenAiDocumentAnalysisService } from './infrastructure/ai/openai-document-analysis.service';
import { BasicFileSecurityService } from './infrastructure/security/basic-file-security.service';
import { DefaultApprovalGateService } from './infrastructure/security/default-approval-gate.service';
import { RequestSignatureService } from './infrastructure/security/request-signature.service';
import { DocumentIngestionController } from './interfaces/http/document-ingestion.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'document-analysis',
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
    BullModule.registerQueue({
      name: 'drive-crawler',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    }),
  ],
  controllers: [DocumentIngestionController],
  providers: [
    postgresPoolProvider,
    IngestDocumentService,
    AnalyzeDocumentService,
    ApproveDocumentService,
    DownloadDriveDocumentService,
    DocumentQueryService,
    DriveCrawlerService,
    DriveDailyReportService,
    SearchDocumentsService,
    ReprocessDriveDocumentsService,
    DocumentQueueService,
    DocumentAnalysisProcessor,
    DriveCrawlerProcessor,
    DriveCrawlerSchedulerService,
    SourceConnectorsService,
    GoogleDriveSearchMcpTool,
    {
      provide: DOCUMENT_REPOSITORY,
      useClass: PostgresDocumentRepository,
    },
    {
      provide: AUDIT_LOG_REPOSITORY,
      useClass: PostgresAuditLogRepository,
    },
    {
      provide: DRIVE_CLASSIFICATION_STATE_REPOSITORY,
      useClass: PostgresDriveFileClassificationStateRepository,
    },
    {
      provide: DOCUMENT_QUEUE,
      useClass: DocumentQueueService,
    },
    {
      provide: FILE_SECURITY_PORT,
      useClass: BasicFileSecurityService,
    },
    {
      provide: REQUEST_SIGNATURE_PORT,
      useClass: RequestSignatureService,
    },
    {
      provide: AI_ANALYSIS_PORT,
      useClass: OpenAiDocumentAnalysisService,
    },
    {
      provide: DRIVE_STORAGE_PORT,
      useClass: GoogleDriveService,
    },
    {
      provide: DISCORD_NOTIFICATION_PORT,
      useClass: DiscordVdManagerService,
    },
    {
      provide: APPROVAL_GATE_PORT,
      useClass: DefaultApprovalGateService,
    },
    {
      provide: MCP_SEARCH_PORT,
      useClass: GoogleDriveSearchMcpTool,
    },
    PostgresDocumentRepository,
    PostgresAuditLogRepository,
    PostgresDriveFileClassificationStateRepository,
    OpenAiDocumentAnalysisService,
    GoogleDriveService,
    DiscordVdManagerService,
    BasicFileSecurityService,
    RequestSignatureService,
    DefaultApprovalGateService,
  ],
  exports: [MCP_SEARCH_PORT],
})
export class DocumentManagementModule {}
