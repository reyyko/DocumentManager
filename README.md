# workspace-document-manager

This repository is the OpenClaw workspace `workspace-document-manager`.

The intended installation is to clone this repository directly into:

```bash
~/.openclaw/workspace-document-manager
```

That means the final layout on the machine running OpenClaw must look like this:

```text
~/.openclaw/workspace-document-manager/
  AGENTS.md
  BOOTSTRAP.md
  HEARTBEAT.md
  IDENTITY.md
  SOUL.md
  TOOLS.md
  USER.md
  skills/
    gmail/
    google-drive/
```

There must be no extra nesting such as:

```text
~/.openclaw/workspace-document-manager/.openclaw/workspace-document-manager/
```

## Install

Clone directly to the target path:

```bash
git clone https://github.com/reyyko/DocumentManager.git ~/.openclaw/workspace-document-manager
```

If the workspace already exists:

```bash
cd ~/.openclaw/workspace-document-manager
git pull
```

## Purpose

This workspace defines a document-management agent specialized in Gmail and Google Drive.

It is defined by:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `HEARTBEAT.md`
- `IDENTITY.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`

It contains exactly 2 skills:

- `skills/gmail`
- `skills/google-drive`

## Required environment

Set these in the environment used by OpenClaw:

- `MATON_API_KEY`
- `MATON_GMAIL_CONNECTION_ID`
- `MATON_GOOGLE_DRIVE_CONNECTION_ID`
