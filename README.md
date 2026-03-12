# Drive/Gmail Document Agent

NestJS agent specialized in document ingestion, classification, search, and audit for Google Drive and Gmail.
It runs as a standalone API with PostgreSQL and Redis, without the previous OpenClaw wrapper.

## What it does

- polls Gmail for attachments matching a configurable query
- polls Google Drive folders and can crawl/sort existing Drive trees
- stores inbound files locally under `data/`
- runs OCR/document analysis and keeps an audit trail in PostgreSQL
- exposes HTTP endpoints to ingest, search, approve, and download documents

## Repo structure

- `apps/api/`: NestJS API and document-management module
- `scripts/`: OCR and document inspection helpers
- `docker-compose.yml`: local stack for API + PostgreSQL + Redis
- `Dockerfile.api`: production image for the agent

## Setup

1. Copy `.env.example` to `.env`.
2. Fill the Google OAuth variables:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_REDIRECT_URI`
3. Set your source scopes:
   `GMAIL_INGEST_ENABLED=true`
   `GOOGLE_DRIVE_INGEST_FOLDER_IDS=...`
4. Start the stack:

```powershell
docker compose up -d --build
```

Local runtime folders are created under `data/`:

- `data/inbound`
- `data/manual-depot`
- `data/processed`

## Useful commands

Start or rebuild:

```powershell
docker compose up -d --build
```

API logs:

```powershell
docker compose logs -f document-api
```

Stop:

```powershell
docker compose down
```

## Main API endpoints

List recent documents:

```powershell
curl http://127.0.0.1:3000/documents?limit=20
```

Search Google Drive documents:

```powershell
curl -X POST http://127.0.0.1:3000/documents/search `
  -H "Content-Type: application/json" `
  -d "{\"query\":\"contrat transport mars 2026\",\"requesterDiscordId\":\"123456789\"}"
```

Trigger Drive reprocessing:

```powershell
curl -X POST http://127.0.0.1:3000/documents/reprocess-drive `
  -H "Content-Type: application/json" `
  -d "{\"limit\":50,\"statuses\":[\"attention-required\",\"failed\"]}"
```

Manual file ingestion:

```powershell
curl -X POST http://127.0.0.1:3000/documents/ingest-file/manual `
  -F "file=@C:\path\to\document.pdf" `
  -F "sourceId=manual-001" `
  -F "sourceLabel=Depot manuel"
```
