# Course Player

A minimal in-browser video player that scans a course directory, orders items numerically (e.g. `1...`, `2...`), supports nested folders as groups, streams videos with HTTP range requests, shows per-item and per-group durations, and tracks completed videos (checkbox history stored in files locally).

![Course Player Screenshot](media/player.png)

## Features
- Numeric ordering across files and folders: `1 Intro.mp4`, `2 Setup/`, `3 Advanced/`...
- Recursive scan with groups (folders) and videos (files)
- Duration extraction via ffprobe (bundled via `ffprobe-static`), cached to `.duration-cache.json`
- Video streaming with range support
- Right-side contents list with totals and completion checkboxes
- Remembers last played and completed items in the browser

## Requirements

### Development
- Node.js 18+

### Production (Docker)
- Docker 20.10+
- Docker Compose 2.0+

## Installation

### Development Setup
```bash
npm install
```

### Production Setup (Docker)
No installation needed - Docker handles everything!

## Prepare course directory
By default, the server scans a `courses/` directory in the project root. Create it and place your videos (and subfolders) there:

```bash
mkdir -p courses
# Put your files like: courses/1 Intro.mp4, courses/2 Basics/1 Part.mp4, ...
```

Alternatively, set an absolute directory via `COURSE_DIR` environment variable.

## Running

### Development Mode
```bash
npm run dev
```
Then open `http://localhost:4001` in your browser.

Or with custom course directory:
```bash
COURSE_DIR="/absolute/path/to/my/course" npm run dev
```

### Production Mode (Docker Compose)

1. **Create `.env` file** (optional, for easier configuration):
```bash
cat > .env << EOF
COURSE_DIR=/home/ross/Videos/Антон Назаров - Осознанная Меркантильность (2026)
PORT=80
NODE_ENV=production
EOF
```

2. **Build and start services** (the startup script will create necessary data files):

**Linux/macOS:**
```bash
./docker-start.sh
```

**Windows (Command Prompt):**
```cmd
docker-start.bat
```

**Windows (PowerShell):**
```powershell
.\docker-start.ps1
```

**Or manually:**
```bash
# Create data directory and files
mkdir -p data
echo '{}' > data/.duration-cache.json
echo '{"completed":{},"lastPlayedId":null}' > data/.progress.json

# Rebuild and start services
docker-compose down
docker-compose up -d --build
```

3. **Access the application**:
   - Open `http://localhost` in your browser (or `http://localhost:PORT` if you set a custom PORT)

4. **Useful Docker commands**:
```bash
# View logs
docker-compose logs -f

# Restart services
docker-compose restart

# Stop services
docker-compose stop

# Stop and remove containers
docker-compose down

# Rebuild after code changes
docker-compose up -d --build

# View running containers
docker-compose ps
```

**Note**: The course directory is mounted as a read-only volume. Cache and progress files are persisted in the `./data` directory on your host machine.

## Notes
- Supported video extensions: `.mp4, .m4v, .webm, .mkv, .mov, .avi`
- Durations are cached per absolute file path in `.duration-cache.json` (or `./data/.duration-cache.json` in Docker).
- Completion state is per-browser (stored in `localStorage`).
- Production setup uses nginx as a reverse proxy for better performance and video streaming.

## Troubleshooting
- If you see an error like "COURSE_DIR does not exist":
  - Create the `courses/` folder, or
  - Set `COURSE_DIR` to a directory that exists and contains your course videos.
- If durations show as 00:00, ensure the files are readable and `ffprobe` can parse them.