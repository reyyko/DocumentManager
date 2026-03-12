---
name: document-management-agent
description: |
  Document triage and archival workflow for OpenClaw using Gmail and Google Drive. Use when asked to inspect, classify, rename, archive, sort, retrieve, summarize, or organize administrative documents, invoices, receipts, contracts, statements, and email attachments, especially when the work involves Gmail attachments, Google Drive folders, OCR, and clean human-readable filenames.
---

# Document Management Agent

Use this skill as the orchestration layer for document work inside OpenClaw.

## Workflow

1. Start with read-only discovery.
2. Use `gmail` for live mailbox operations.
3. Use `google-drive` for live Drive search, download, export, rename, and move operations.
4. Inspect candidate files locally before proposing archive actions.
5. Present a final filename and destination folder before executing any non-trivial rename or move.

## Inspection

- Use `scripts/inspect_document.py` for a quick local inspection of PDF, DOCX, ZIP, and text-like files.
- Use `scripts/paddle_ocr_extract.py` only when PaddleOCR is available on the host and the document appears scan-only.
- Prefer inspecting only the files needed to make a classification.

## Naming rules

- Keep filenames human-readable.
- Never use UUID-style names.
- Preserve the original extension.
- Prefer this pattern when enough data is known:
  `YYYY-MM-DD - Document Type - Counterparty - Subject.ext`
- If the exact date is unknown, use the best reliable date fragment or omit it instead of inventing one.
- Normalize obvious noise like repeated spaces, tracking IDs, or mail gateway prefixes when they add no retrieval value.

## Gmail rules

- Search before opening full threads.
- For attachments, fetch the full message and inspect the attachment set.
- Remove `UNREAD` only after successful classification or user-approved processing.
- Be careful with inline images and decorative assets. Ignore them unless the user explicitly wants them.

## Google Drive rules

- Search first with narrow queries and explicit `fields=`.
- Export Google Docs to PDF before downstream document inspection when binary delivery is needed.
- Prefer move-in-place over duplication for archive operations unless the user asks to keep a copy.
- For bulk operations, sample a few files first and show the inferred rule.

## Decision policy

- If confidence is high and the user asked for action, execute.
- If confidence is medium or the operation is bulk, show the proposed action first.
- If confidence is low, explain the uncertainty and ask for the missing signal.
