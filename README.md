# OpenClaw Document Agent

Portable OpenClaw workspace bundle for a document-management agent focused on Gmail and Google Drive.

This repository is meant to be installed into an existing OpenClaw workspace. It does not ship a standalone app stack.

## Included

- workspace root files for the agent personality and behavior
- `skills/gmail/` for live Gmail access through Maton
- `skills/google-drive/` for live Google Drive access through Maton
- `skills/document-management-agent/` for document triage, naming, OCR, and archive workflow

## Install into an existing OpenClaw workspace

Linux:

```bash
./install-openclaw-agent.sh ~/.openclaw/workspace
```

PowerShell:

```powershell
.\install-openclaw-agent.ps1 -WorkspacePath "$HOME/.openclaw/workspace"
```

Manual install:

1. Copy the root markdown files into your OpenClaw workspace root.
2. Copy the `skills/` directory into your OpenClaw workspace.
3. Restart OpenClaw or reload the workspace.

## Required environment

Set these in the environment used by your OpenClaw server:

- `MATON_API_KEY`
- `MATON_GMAIL_CONNECTION_ID`
- `MATON_GOOGLE_DRIVE_CONNECTION_ID`

If you use multiple Maton connections, keep the connection IDs set explicitly.

## Resulting workspace layout

```text
~/.openclaw/workspace/
  AGENTS.md
  IDENTITY.md
  SOUL.md
  USER.md
  TOOLS.md
  HEARTBEAT.md
  skills/
    gmail/
    google-drive/
    document-management-agent/
```

## Notes

- The agent is optimized for read, classify, rename, move, summarize, and archive workflows.
- Filenames should stay clean and human-readable, never UUID-style.
- The bundled OCR helper is optional and only used when PaddleOCR is available on the host.
