# Quick Sort Player

A fast, local browser UI for triaging files and inspecting images and video at
pixel level. The app binds to `127.0.0.1` only: files never leave your computer.

## What it does

- Thumbnail contact sheet for folders, images, video, audio, apps, and files
- Large image previews and muted autoplaying video previews on thumbnail hover
- Image and video zoom from Fit through 800%, with drag-to-pan pixel inspection
- Autoplay on video selection; click the preview itself to play or pause
- Full video controls: seek, volume, mute, ±10/30 second jumps, 0.5×–2× speed,
  frame stepping, filmstrip, fullscreen, and picture-in-picture; originals play without transcoding
- Configurable, renameable one-key moves (up to nine) with native folder pickers and drag-and-drop
- Auto-advance after sorting and Shift-click range selection
- Keep/Reject queues, ratings, tags, review progress, and resumable folder sessions
- Side-by-side media comparison with synchronized playback and zoom
- Exact and visual duplicate finding, batch rename previews, and metadata inspection
- Local fuzzy search across names, types, tags, ratings, and review status
- Collapsible Library, file rail, Places, and destination sections
- Fully customizable keyboard shortcuts
- Background thumbnail indexing for large folders
- Recoverable Recycle Bin / Trash action (`Delete`)
- Undo for ordinary moves (`Ctrl+Z`)
- Direct location chords such as `G` then `D` for Downloads
- Command palette (`Ctrl+K`), search (`/`), and a complete keyboard map (`?`)
- Native reveal in Explorer/Finder
- Open-in-default-app fallback for browser-incompatible media and documents
- Recent folders in the command palette
- Automatic browser refresh while source files change

## Windows

Install Python 3.11 or newer from [python.org](https://python.org/downloads/).
Download and extract this repository, then open PowerShell in the folder:

```powershell
.\setup.cmd
.\run.cmd
```

The app opens automatically at [http://127.0.0.1:8767](http://127.0.0.1:8767).
Keep the terminal open while using it. Press `Ctrl+C` there to stop the server.

## macOS / Linux

```sh
chmod +x setup.sh run.sh
./setup.sh
./run.sh
```

## Development loop

Run the development launcher and edit anything under `src/quicksortplayer/`. Python,
HTML, CSS, and JavaScript changes restart the local service and refresh the open
browser page automatically.

On Windows, use `run-dev.cmd` for live reload; `run.cmd` is the more reliable
everyday launcher and avoids creating an extra filesystem-watcher process.

Choose another port if needed:

```sh
./run.sh --port 9000
```

or on Windows:

```powershell
.\run-dev.cmd --port 9000
```

## Safety

- The server listens only on `127.0.0.1`, not your LAN.
- Move collisions are renamed instead of overwritten.
- There is no permanent-delete action.
- Recycle Bin / Trash moves require confirmation and remain OS-recoverable.
- Ordinary file moves can be undone until the server restarts.

## Tests

```sh
python -m pytest -q
```
