from __future__ import annotations

import argparse
import os
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn


def _open_when_ready(url: str) -> None:
    time.sleep(1.2)
    webbrowser.open(url)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Quick Sort Player locally with live reload")
    parser.add_argument("--port", type=int, default=int(os.environ.get("QUICK_SORT_PORT", "8767")))
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-reload", action="store_true")
    args = parser.parse_args()

    url = f"http://127.0.0.1:{args.port}"
    if not args.no_browser:
        threading.Thread(target=_open_when_ready, args=(url,), daemon=True).start()
    print(f"Quick Sort Player: {url}")
    print("Local-only server. Press Ctrl+C to stop.")

    source_dir = Path(__file__).resolve().parents[1]
    uvicorn.run(
        "quicksortplayer.server:app",
        host="127.0.0.1",
        port=args.port,
        reload=not args.no_reload,
        reload_dirs=[str(source_dir)],
        reload_includes=["*.py", "*.html", "*.css", "*.js"],
        log_level="warning",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
