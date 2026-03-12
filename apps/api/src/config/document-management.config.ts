import { registerAs } from '@nestjs/config';

export const documentManagementConfig = registerAs('documentManagement', () => ({
  nativeGoogle: {
    enabled:
      process.env.NATIVE_GOOGLE_CONNECTORS_ENABLED === 'true' &&
      Boolean(process.env.GOOGLE_CLIENT_ID) &&
      Boolean(process.env.GOOGLE_CLIENT_SECRET) &&
      Boolean(process.env.GOOGLE_REFRESH_TOKEN) &&
      Boolean(process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/oauth2callback'),
  },
  queueName: 'document-analysis',
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  postgresUrl: process.env.POSTGRES_URL ?? '',
  ingestionSharedSecret: process.env.INGESTION_SHARED_SECRET ?? '',
  defaultApproverDiscordId: process.env.DEFAULT_APPROVER_DISCORD_ID ?? '',
  discord: {
    token: process.env.DISCORD_BOT_TOKEN ?? '',
    vdManagerChannelId: process.env.DISCORD_VD_MANAGER_CHANNEL_ID ?? '',
  },
  googleDrive: {
    rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? '',
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/oauth2callback',
  },
  openAi: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  },
  storage: {
    documentStorageDir: process.env.DOCUMENT_STORAGE_DIR ?? '.openclaw/media/inbound',
    manualDepotDir: process.env.MANUAL_DEPOT_DIR ?? 'workspace/inbound/manual-depot',
    processedDepotDir: process.env.PROCESSED_DEPOT_DIR ?? 'workspace/inbound/processed',
  },
  analysis: {
    enableVisionOcr: process.env.ENABLE_VISION_OCR === 'true',
    maxRenderedPages: Number(process.env.VISION_MAX_RENDERED_PAGES ?? 4),
    enablePaddleOcr: process.env.ENABLE_PADDLE_OCR !== 'false',
    paddleOcrLang: process.env.PADDLE_OCR_LANG ?? 'fr',
  },
  security: {
    maxFileSizeBytes: Number(process.env.DOCUMENT_MAX_FILE_SIZE_MB ?? 75) * 1024 * 1024,
  },
  connectors: {
    pollIntervalMs: Number(process.env.CONNECTOR_POLL_INTERVAL_MS ?? 30000),
    discordChannelIds: (process.env.DISCORD_INGEST_CHANNEL_IDS ?? process.env.DISCORD_VD_MANAGER_CHANNEL_ID ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    gmailEnabled: process.env.GMAIL_INGEST_ENABLED === 'true',
    gmailQuery: process.env.GMAIL_INGEST_QUERY ?? 'has:attachment is:unread',
    googleDriveFolderIds: (process.env.GOOGLE_DRIVE_INGEST_FOLDER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  },
  driveCrawler: {
    enabled: process.env.GOOGLE_DRIVE_CRAWLER_ENABLED !== 'false',
    queueName: 'drive-crawler',
    scanCron: process.env.GOOGLE_DRIVE_CRAWLER_CRON ?? '*/15 * * * *',
    reportCron: process.env.GOOGLE_DRIVE_CRAWLER_REPORT_CRON ?? '0 18 * * *',
    reportTimezone: process.env.GOOGLE_DRIVE_CRAWLER_REPORT_TIMEZONE ?? 'Europe/Paris',
    batchSize: Number(process.env.GOOGLE_DRIVE_CRAWLER_BATCH_SIZE ?? 50),
    folderIds: (process.env.GOOGLE_DRIVE_CRAWLER_FOLDER_IDS ?? process.env.GOOGLE_DRIVE_INGEST_FOLDER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  },
  routing: {
    finance: process.env.DISCORD_FINANCE_CHANNEL_ID ?? '',
    logistics: process.env.DISCORD_LOGISTICS_CHANNEL_ID ?? '',
    contracts: process.env.DISCORD_CONTRACTS_CHANNEL_ID ?? '',
  },
}));
