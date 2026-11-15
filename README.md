# Quick Sort Player

A fast, local browser UI for triaging files and inspecting images and video at
pixel level. The app binds to `127.0.0.1` only: files never leave your computer.

## What it does

- Thumbnail contact sheet for folders, images, video, audio, apps, and files
- Image and video zoom from Fit through 800%, with drag-to-pan pixel inspection
- Video-only transport controls, rapid ±10/30 second jumps, and 0.5×–2× speed
- Configurable one-key moves (`1`–`4`) with collision-safe filenames
- Recoverable Recycle Bin / Trash action (`Ctrl+Backspace`)
- Undo for ordinary moves (`Ctrl+Z`)
- Direct location chords such as `G` then `D` for Downloads
- Command palette (`Ctrl+K`), search (`/`), and a complete keyboard map (`?`)
- Native reveal in Explorer/Finder
- Automatic browser refresh while source files change

## Windows

Install Python 3.11 or newer from [python.org](https://python.org/downloads/).
Download and extract this repository, then open PowerShell in the folder:

```powershell
.\setup.cmd
.\run.cmd
```

The app opens automatically at [http://127.0.0.1:8766](http://127.0.0.1:8766).
Keep the terminal open while using it. Press `Ctrl+C` there to stop the server.

## macOS / Linux

```sh
chmod +x setup.sh run.sh
./setup.sh
./run.sh
```

## Development loop

Run the same launcher and edit anything under `src/quicksortplayer/`. Python,
HTML, CSS, and JavaScript changes restart the local service and refresh the open
browser page automatically.

Choose another port if needed:

```sh
./run.sh --port 9000
```

or on Windows:

```powershell
.\run.cmd --port 9000
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
