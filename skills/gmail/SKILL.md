---
name: gmail
description: |
  Gmail API integration with managed OAuth. Use this skill when users want to interact with Gmail messages, threads, labels, drafts, sending, or attachment retrieval through Maton.
---

# Gmail

Use Maton as the Gmail transport layer instead of native Google OAuth code.

## Required env

- `MATON_API_KEY`
- Optional: `MATON_GMAIL_CONNECTION_ID`

## Base URL

`https://gateway.maton.ai/google-mail/{native-api-path}`

Example native path:

- `/gmail/v1/users/me/messages`
- `/gmail/v1/users/me/messages/{messageId}`
- `/gmail/v1/users/me/threads/{threadId}`
- `/gmail/v1/users/me/messages/{messageId}/modify`

## Authentication

Always send:

- `Authorization: Bearer $MATON_API_KEY`

If multiple connections exist, also send:

- `Maton-Connection: $MATON_GMAIL_CONNECTION_ID`

## Connection management

Use `https://ctrl.maton.ai/connections` with:

- `app=google-mail`
- `status=ACTIVE`

If no active connection exists, create one and open the returned `url` to complete OAuth.

## Preferred operations

- List messages:
  - `GET /gmail/v1/users/me/messages?q=...&maxResults=...`
- Get message:
  - `GET /gmail/v1/users/me/messages/{messageId}?format=full`
- Get metadata only:
  - `GET /gmail/v1/users/me/messages/{messageId}?format=metadata`
- Modify labels:
  - `POST /gmail/v1/users/me/messages/{messageId}/modify`
- List threads:
  - `GET /gmail/v1/users/me/threads`
- Send raw message:
  - `POST /gmail/v1/users/me/messages/send`

## Query reminders

Common filters:

- `is:unread`
- `has:attachment`
- `from:...`
- `subject:...`
- `after:2026/01/01`

## Notes

- Message bodies and attachments are base64url encoded in Gmail payloads.
- For documentary ingestion, fetch `format=full`, walk `parts`, and pull attachment bodies by `attachmentId`.
- Remove `UNREAD` only after successful processing.
