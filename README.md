# OpenClaw local container

This project now combines the official OpenClaw gateway with a local document-management API runtime.
The document pipeline itself runs locally by default and does not require the OpenAI API.
Local OCR for scanned PDFs and images is handled with PaddleOCR when enabled.
The Google Drive module now prioritizes archival quality: files can be renamed to a standardized format and moved in place inside the business tree.

## Structure

- `docker-compose.yml`: official-style OpenClaw gateway + CLI stack
- `apps/api/`: NestJS document-management pipeline (ingestion, queue, analysis, Drive, audit, search)
- `apps/api/`: NestJS document-management pipeline (ingestion, queue, analysis, Drive crawler, audit, reporting)
- `workspace/skills/gmail/`: workspace Gmail skill through Maton
- `workspace/skills/google-drive/`: workspace Google Drive skill through Maton
- `.openclaw/`: runtime state and config generated locally
- `scripts/setup-openclaw.ps1`: Windows-friendly bootstrap script

## First setup

1. Fill `.env` from `.env.example`.
2. Run:

```powershell
.\scripts\setup-openclaw.ps1
```

The script:

- creates the OpenClaw state/workspace folders
- ensures gateway env defaults exist
- writes a minimal `openclaw.json`
- sets the default model to `openai-codex/gpt-5.4`
- enables Discord when a token is present
- derives the Discord guild from `DISCORD_VD_MANAGER_CHANNEL_ID` when possible
- mounts the Maton-backed `gmail` and `google-drive` workspace skills
- creates the manual inbound folders under `workspace/inbound/`
- starts `openclaw-gateway`, `document-api`, `postgres`, and `redis`

## Codex login

This setup is aligned for ChatGPT/Codex account auth for the gateway.
The backend document sorter does not consume your ChatGPT subscription directly.

Run:

```powershell
docker compose run --rm openclaw-cli models auth login --provider openai-codex
```

Then verify:

```powershell
docker compose run --rm openclaw-cli models status
```

## Daily commands

Start or refresh:

```powershell
docker compose up -d --build
```

See logs:

```powershell
docker compose logs -f openclaw-gateway
```

API logs:

```powershell
docker compose logs -f document-api
```

Open dashboard:

```powershell
docker compose run --rm openclaw-cli dashboard --no-open
```

List skills seen by OpenClaw:

```powershell
docker compose run --rm openclaw-cli skills
```

Live Google access is now handled by Maton skills.
Keep `MATON_API_KEY`, `MATON_GOOGLE_DRIVE_CONNECTION_ID`, and `MATON_GMAIL_CONNECTION_ID` in `.env`.
Keep `NATIVE_GOOGLE_CONNECTORS_ENABLED=false` unless you explicitly want to reactivate the old OAuth-based Google connectors.

Manual folder ingestion:

- drop files into `workspace/inbound/manual-depot`
- the API polls the folder and queues new documents automatically

HTTP file ingestion:

```powershell
curl -X POST http://127.0.0.1:3000/documents/ingest-file/manual `
  -F "file=@C:\path\to\document.pdf" `
  -F "sourceId=manual-001" `
  -F "sourceLabel=Depot manuel"
```

Webhook ingestion for Odoo / Shopify:

```powershell
curl -X POST http://127.0.0.1:3000/documents/webhook/shopify `
  -H "Content-Type: application/json" `
  -d "{\"originalFileName\":\"facture.pdf\",\"fileUrl\":\"https://example.com/facture.pdf\",\"sourceId\":\"shopify-123\"}"
```

List recent documents:

```powershell
curl http://127.0.0.1:3000/documents?limit=20
```

Stop:

```powershell
docker compose down
```
