# PowerShell script to rebuild and start Docker containers

# Load .env file if it exists
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            Set-Variable -Name $name -Value $value -Scope Script
        }
    }
}

# Create data directory and cache files if they don't exist
if (-not (Test-Path data)) {
    New-Item -ItemType Directory -Path data | Out-Null
}

# Docker creates directories when bind-mount targets are missing; replace with files
foreach ($file in @('data\.duration-cache.json', 'data\.progress.json')) {
    if (Test-Path $file -PathType Container) {
        Remove-Item -Recurse -Force $file
    }
}

# Create empty JSON files if they don't exist
if (-not (Test-Path data\.duration-cache.json)) {
    '{}' | Out-File -FilePath data\.duration-cache.json -Encoding utf8
}

if (-not (Test-Path data\.progress.json)) {
    '{"completed":{},"lastPlayedId":null}' | Out-File -FilePath data\.progress.json -Encoding utf8
}

# Check if COURSE_DIR is set and exists
if (-not $COURSE_DIR) {
    $COURSE_DIR = ".\courses"
}

if (-not (Test-Path $COURSE_DIR)) {
    Write-Host "ERROR: Course directory does not exist: $COURSE_DIR" -ForegroundColor Red
    Write-Host "Please set COURSE_DIR in .env file or ensure .\courses directory exists"
    exit 1
}

# Check if directory is empty
$files = Get-ChildItem -Path $COURSE_DIR -ErrorAction SilentlyContinue
if ($null -eq $files -or $files.Count -eq 0) {
    Write-Host "WARNING: Course directory is empty: $COURSE_DIR" -ForegroundColor Yellow
    Write-Host "The container will fail to start if the directory remains empty."
    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        exit 1
    }
}

# Rebuild and start docker compose
Write-Host "Rebuilding and starting Docker containers..." -ForegroundColor Cyan
docker compose down
docker compose up -d --build

# Wait a moment and check if containers are running
Start-Sleep -Seconds 2
$running = docker compose ps 2>&1 | Select-String -Pattern "Up"

if (-not $running) {
    Write-Host ""
    Write-Host "Some containers may have failed to start." -ForegroundColor Yellow
    Write-Host "Check logs with: docker compose logs"
    exit 1
} else {
    Write-Host ""
    Write-Host "Services started successfully!" -ForegroundColor Green
    if ($PORT) {
        Write-Host "Access the application at http://localhost:$PORT"
    } else {
        Write-Host "Access the application at http://localhost"
    }
    Write-Host ""
    Write-Host "View logs with: docker compose logs -f"
    Write-Host "Check status with: docker compose ps"
}
