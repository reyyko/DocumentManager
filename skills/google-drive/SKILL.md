---
name: google-drive
description: |
  Google Drive API integration with managed OAuth. Use this skill when users want to interact with Google Drive files, folders, search, download, upload, rename, move, export, or share operations through Maton.
---

# Google Drive

Use Maton as the Google Drive transport layer instead of native Google OAuth code.

## Required env

- `MATON_API_KEY`
- Optional: `MATON_GOOGLE_DRIVE_CONNECTION_ID`

## Base URL

`https://gateway.maton.ai/google-drive/{native-api-path}`

Example native path:

- `/drive/v3/files`
- `/drive/v3/files/{fileId}`
- `/drive/v3/files/{fileId}/export?mimeType=application/pdf`
- `/upload/drive/v3/files?uploadType=resumable`

## Authentication

Always send:

- `Authorization: Bearer $MATON_API_KEY`

If multiple connections exist, also send:

- `Maton-Connection: $MATON_GOOGLE_DRIVE_CONNECTION_ID`

## Connection management

Use `https://ctrl.maton.ai/connections` with:

- `app=google-drive`
- `status=ACTIVE`

If no active connection exists, create one and open the returned `url` to complete OAuth.

## Preferred operations

- Search files:
  - `GET /drive/v3/files?q=...&fields=files(id,name,mimeType,parents,webViewLink,modifiedTime)`
- Get metadata:
  - `GET /drive/v3/files/{fileId}?fields=id,name,mimeType,parents,size,webViewLink,modifiedTime`
- Download binary file:
  - `GET /drive/v3/files/{fileId}?alt=media`
- Export Google Docs/Sheets/Slides:
  - `GET /drive/v3/files/{fileId}/export?mimeType=application/pdf`
- Rename / move:
  - `PATCH /drive/v3/files/{fileId}`
  - `PATCH /drive/v3/files/{fileId}?addParents=NEW&removeParents=OLD`
- Create folder:
  - `POST /drive/v3/files` with `mimeType=application/vnd.google-apps.folder`

## Query reminders

Common filters:

- `name contains 'contrat'`
- `mimeType = 'application/pdf'`
- `'FOLDER_ID' in parents`
- `trashed = false`
- `modifiedTime > '2026-01-01T00:00:00'`

Combine with `and`.

## Notes

- Prefer `fields=` to reduce payload size.
- Export Google Workspace files to PDF before attachment delivery when the target system expects a binary file.
- Use resumable uploads for files larger than 5 MB.
- Keep rename + move in place when archiving, instead of duplicating files.
