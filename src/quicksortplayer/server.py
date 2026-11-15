from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from imageio_ffmpeg import get_ffmpeg_exe
from PIL import Image, ImageOps
from pydantic import BaseModel
from send2trash import send2trash
from starlette.concurrency import run_in_threadpool

from .file_ops import AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, MoveRecord, category_for, move_paths, undo_moves


APP_STARTED = str(time.time_ns())
PACKAGE_DIR = Path(__file__).resolve().parent
STATIC_DIR = PACKAGE_DIR / "static"
STATE_DIR = Path(os.environ.get("QUICK_SORT_STATE_DIR", Path.home() / ".quick-sort-player"))
THUMB_DIR = STATE_DIR / "thumbnails"
CONFIG_FILE = STATE_DIR / "config.json"
MAX_THUMB_EDGE = 320

app = FastAPI(title="Quick Sort Player", docs_url=None, redoc_url=None)
undo_stack: list[list[MoveRecord]] = []


@app.middleware("http")
async def disable_browser_cache(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


class MoveRequest(BaseModel):
    paths: list[str]
    destination: str


class PathsRequest(BaseModel):
    paths: list[str]


class RevealRequest(BaseModel):
    path: str


class ConfigRequest(BaseModel):
    destinations: dict[Literal["apps", "videos", "images", "files"], str]
    labels: dict[Literal["apps", "videos", "images", "files"], str] | None = None


def default_destinations() -> dict[str, str]:
    home = Path.home()
    return {
        "apps": str(home / "Sorted" / "Apps"),
        "videos": str(home / "Videos" / "Sorted"),
        "images": str(home / "Pictures" / "Sorted"),
        "files": str(home / "Documents" / "Sorted"),
    }


def default_labels() -> dict[str, str]:
    return {"apps": "Apps", "videos": "Media", "images": "Images", "files": "Files"}


def load_config() -> dict[str, object]:
    base: dict[str, object] = {
        "destinations": default_destinations(),
        "labels": default_labels(),
        "show_hidden": False,
    }
    try:
        stored = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        if isinstance(stored, dict):
            base.update(stored)
    except (OSError, json.JSONDecodeError):
        pass
    return base


def save_config(config: dict[str, object]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    temporary = CONFIG_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    temporary.replace(CONFIG_FILE)


def checked_path(raw: str, *, require_file: bool = False, require_dir: bool = False) -> Path:
    path = Path(raw).expanduser().resolve()
    if not path.exists():
        raise HTTPException(404, f"Path does not exist: {path}")
    if require_file and not path.is_file():
        raise HTTPException(400, "A file path is required")
    if require_dir and not path.is_dir():
        raise HTTPException(400, "A folder path is required")
    return path


def human_kind(path: Path) -> str:
    if path.is_dir():
        return "Folder"
    suffix = path.suffix.lower().removeprefix(".")
    labels = {
        "jpg": "JPEG image", "jpeg": "JPEG image", "png": "PNG image", "gif": "GIF image",
        "webp": "WebP image", "heic": "HEIC image", "mp4": "MP4 video", "mov": "QuickTime video",
        "mkv": "Matroska video", "webm": "WebM video", "mp3": "MP3 audio", "wav": "WAV audio",
        "pdf": "PDF document", "exe": "Windows application", "msi": "Windows installer",
    }
    return labels.get(suffix, f"{suffix.upper()} file" if suffix else "File")


def item_payload(path: Path) -> dict[str, object]:
    stat = path.stat()
    category = "folder" if path.is_dir() else category_for(path)
    suffix = path.suffix.lower()
    previewable = suffix in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS | AUDIO_EXTENSIONS
    return {
        "name": path.name,
        "path": str(path),
        "is_dir": path.is_dir(),
        "category": category,
        "kind": human_kind(path),
        "extension": suffix,
        "size": 0 if path.is_dir() else stat.st_size,
        "modified": stat.st_mtime,
        "previewable": previewable,
        "thumbnail": previewable,
    }


def common_locations() -> list[dict[str, str]]:
    home = Path.home()
    candidates = [
        ("Home", home, "H"),
        ("Desktop", home / "Desktop", "B"),
        ("Downloads", home / "Downloads", "D"),
        ("Pictures", home / "Pictures", "P"),
        ("Videos", home / "Videos", "V"),
        ("Documents", home / "Documents", "O"),
    ]
    if sys.platform == "darwin":
        candidates.append(("Applications", Path("/Applications"), "A"))
    elif sys.platform == "win32":
        program_files = os.environ.get("ProgramFiles")
        if program_files:
            candidates.append(("Applications", Path(program_files), "A"))
    return [
        {"name": name, "path": str(path.resolve()), "hotkey": hotkey}
        for name, path, hotkey in candidates if path.exists()
    ]


def thumb_cache_path(path: Path) -> Path:
    stat = path.stat()
    digest = hashlib.sha256(f"{path}:{stat.st_mtime_ns}:{stat.st_size}".encode()).hexdigest()
    return THUMB_DIR / f"{digest}.jpg"


def create_thumbnail(path: Path, destination: Path) -> None:
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp.jpg")
    suffix = path.suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        with Image.open(path) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode not in {"RGB", "L"}:
                background = Image.new("RGB", image.size, "#111111")
                if "A" in image.getbands():
                    background.paste(image, mask=image.getchannel("A"))
                else:
                    background.paste(image)
                image = background
            image.thumbnail((MAX_THUMB_EDGE, MAX_THUMB_EDGE), Image.Resampling.LANCZOS)
            image.convert("RGB").save(temporary, "JPEG", quality=84, optimize=True)
    elif suffix in VIDEO_EXTENSIONS:
        command = [
            get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-ss", "1",
            "-i", str(path), "-frames:v", "1", "-vf",
            f"scale={MAX_THUMB_EDGE}:{MAX_THUMB_EDGE}:force_original_aspect_ratio=decrease",
            "-q:v", "4", "-y", str(temporary),
        ]
        subprocess.run(command, check=True, timeout=30)
    else:
        raise ValueError("No thumbnail generator for this file type")
    temporary.replace(destination)


def choose_folder_native() -> str | None:
    if sys.platform == "darwin":
        result = subprocess.run(
            ["osascript", "-e", "POSIX path of (choose folder with prompt \"Choose a folder\")"],
            text=True, capture_output=True,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    if sys.platform == "win32":
        script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$d=New-Object System.Windows.Forms.FolderBrowserDialog; "
            "if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", script],
            text=True, capture_output=True,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    executable = shutil.which("zenity")
    if executable:
        result = subprocess.run([executable, "--file-selection", "--directory"], text=True, capture_output=True)
        return result.stdout.strip() if result.returncode == 0 else None
    return None


def source_version() -> str:
    candidates = list(PACKAGE_DIR.glob("*.py")) + list(STATIC_DIR.glob("*"))
    latest = max((path.stat().st_mtime_ns for path in candidates if path.is_file()), default=0)
    return str(latest)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {"ok": True, "started": APP_STARTED, "version": source_version()}


@app.get("/api/locations")
def locations() -> dict[str, object]:
    return {"locations": common_locations(), "config": load_config(), "platform": sys.platform}


@app.get("/api/list")
def list_directory(path: str = Query(default=str(Path.home())), show_hidden: bool = False) -> dict[str, object]:
    folder = checked_path(path, require_dir=True)
    try:
        entries = [entry for entry in folder.iterdir() if show_hidden or not entry.name.startswith(".")]
        entries.sort(key=lambda entry: (not entry.is_dir(), entry.name.casefold()))
        items = []
        for entry in entries:
            try:
                items.append(item_payload(entry))
            except OSError:
                continue
    except PermissionError as error:
        raise HTTPException(403, str(error)) from error
    parent = str(folder.parent) if folder.parent != folder else None
    return {"path": str(folder), "parent": parent, "items": items}


@app.get("/api/media")
def media(path: str) -> FileResponse:
    file_path = checked_path(path, require_file=True)
    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return FileResponse(file_path, media_type=media_type, filename=file_path.name, content_disposition_type="inline")


@app.get("/api/thumbnail")
async def thumbnail(path: str) -> Response:
    file_path = checked_path(path, require_file=True)
    destination = thumb_cache_path(file_path)
    if not destination.exists():
        try:
            await run_in_threadpool(create_thumbnail, file_path, destination)
        except Exception:
            return Response(status_code=204)
    return FileResponse(destination, media_type="image/jpeg")


@app.post("/api/move")
def move(request: MoveRequest) -> dict[str, object]:
    destination = Path(request.destination).expanduser().resolve()
    records = move_paths([Path(value) for value in request.paths], destination)
    if records:
        undo_stack.append(records)
    return {"moved": len(records), "destination": str(destination)}


@app.post("/api/undo")
def undo() -> dict[str, object]:
    if not undo_stack:
        return {"restored": 0, "skipped": 0}
    restored, skipped = undo_moves(undo_stack.pop())
    return {"restored": len(restored), "skipped": len(skipped)}


@app.post("/api/trash")
def trash(request: PathsRequest) -> dict[str, object]:
    paths = [checked_path(value) for value in request.paths]
    for path in paths:
        send2trash(str(path))
    return {"trashed": len(paths)}


@app.post("/api/reveal")
def reveal(request: RevealRequest) -> dict[str, bool]:
    path = checked_path(request.path)
    if sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", str(path)])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path.parent if path.is_file() else path)])
    return {"ok": True}


@app.post("/api/open")
def open_in_default_app(request: RevealRequest) -> dict[str, bool]:
    path = checked_path(request.path)
    if sys.platform == "win32":
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])
    return {"ok": True}


@app.post("/api/pick-folder")
async def pick_folder() -> dict[str, str | None]:
    selected = await run_in_threadpool(choose_folder_native)
    return {"path": selected}


@app.put("/api/config")
def update_config(request: ConfigRequest) -> dict[str, object]:
    config = load_config()
    config["destinations"] = request.destinations
    if request.labels is not None:
        config["labels"] = request.labels
    save_config(config)
    return config


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
