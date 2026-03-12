#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-$HOME/.openclaw/workspace}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/workspace-document-manager"

mkdir -p "$TARGET/skills"

for file in AGENTS.md BOOTSTRAP.md HEARTBEAT.md IDENTITY.md SOUL.md TOOLS.md USER.md; do
  cp "$SOURCE_DIR/$file" "$TARGET/$file"
done

rm -rf "$TARGET/skills/gmail" "$TARGET/skills/google-drive"
cp -R "$SOURCE_DIR/skills/gmail" "$TARGET/skills/gmail"
cp -R "$SOURCE_DIR/skills/google-drive" "$TARGET/skills/google-drive"
rm -rf "$TARGET/skills/document-management-agent"

echo "workspace-document-manager installed in $TARGET"
