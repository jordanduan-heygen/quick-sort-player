#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${QUICK_SORT_PYTHON:-}" ]; then
  python_bin=$QUICK_SORT_PYTHON
elif [ -x /opt/homebrew/bin/python3 ]; then
  python_bin=/opt/homebrew/bin/python3
else
  python_bin=$(command -v python3)
fi
if ! "$python_bin" -c 'import sys; raise SystemExit(sys.version_info < (3, 11))'; then
  printf '%s\n' "Python 3.11 or newer is required." >&2
  exit 2
fi
"$python_bin" -m venv --clear "$project_dir/.venv"
"$project_dir/.venv/bin/python" -m pip install --upgrade pip
"$project_dir/.venv/bin/python" -m pip install -e "$project_dir[dev]"
printf '%s\n' "Installed. Run: $project_dir/run.sh"
