#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' "npm was not found on PATH. Install Node.js and npm before running Steam Uploader."
  exit 1
fi

exec npm run dev
