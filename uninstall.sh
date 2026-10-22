#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ID="win11-fullscreen-stacking"
TARGET_DIR="${HOME}/.local/share/kwin/scripts/${SCRIPT_ID}"

kwriteconfig6 --file kwinrc --group Plugins --key "${SCRIPT_ID}Enabled" --delete || true

if command -v qdbus6 >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${SCRIPT_ID}" >/dev/null 2>&1 || true
    qdbus6 org.kde.KWin /KWin reconfigure
elif command -v qdbus >/dev/null 2>&1; then
    qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${SCRIPT_ID}" >/dev/null 2>&1 || true
    qdbus org.kde.KWin /KWin reconfigure
fi

rm -rf "${TARGET_DIR}"
echo "Uninstalled '${SCRIPT_ID}'"
