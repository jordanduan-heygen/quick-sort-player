#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -x "$project_dir/.venv/bin/quick-sort-player" ]; then
  printf '%s\n' "Run ./setup.sh first." >&2
  exit 2
fi
exec "$project_dir/.venv/bin/quick-sort-player" "$@"
