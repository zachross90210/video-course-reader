@echo off
setlocal enabledelayedexpansion

REM Load .env if it exists (for pre-flight validation only)
if exist .env (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
        set "%%a=%%b"
    )
)

REM Strip surrounding quotes from COURSE_DIR if present
if defined COURSE_DIR (
    if "!COURSE_DIR:~0,1!"=="\"" set "COURSE_DIR=!COURSE_DIR:~1!"
    if "!COURSE_DIR:~-1!"=="\"" set "COURSE_DIR=!COURSE_DIR:~0,-1!"
)

REM Create data directory and cache files if they don't exist
if not exist data mkdir data

REM Docker creates directories when bind-mount targets are missing; replace with files
if exist data\.duration-cache.json\ (
    rmdir /s /q data\.duration-cache.json
)
if exist data\.progress.json\ (
    rmdir /s /q data\.progress.json
)

REM Create empty JSON files if they don't exist
if not exist data\.duration-cache.json (
    echo {} > data\.duration-cache.json
)
if not exist data\.progress.json (
    echo {"completed":{},"lastPlayedId":null} > data\.progress.json
)

REM Check if COURSE_DIR is set and exists
if "%COURSE_DIR%"=="" set COURSE_DIR=.\courses

if not exist "%COURSE_DIR%" (
    echo ERROR: Course directory does not exist: %COURSE_DIR%
    echo Please set COURSE_DIR in .env file or ensure .\courses directory exists
    exit /b 1
)

REM Check if directory is empty
dir /b "%COURSE_DIR%" >nul 2>&1
if errorlevel 1 (
    echo WARNING: Course directory is empty: %COURSE_DIR%
    echo The container will fail to start if the directory remains empty.
    set /p continue="Continue anyway? (y/N): "
    if /i not "!continue!"=="y" exit /b 1
)

REM Rebuild and start docker compose
echo Rebuilding and starting Docker containers...
docker compose down
docker compose up -d --build

REM Wait a moment and check if containers are running
timeout /t 2 /nobreak >nul
docker compose ps | findstr /i "Up" >nul
if errorlevel 1 (
    echo.
    echo Some containers may have failed to start.
    echo Check logs with: docker compose logs
    exit /b 1
) else (
    echo.
    echo Services started successfully!
    if "%PORT%"=="" (
        echo Access the application at http://localhost
    ) else (
        echo Access the application at http://localhost:%PORT%
    )
    echo.
    echo View logs with: docker compose logs -f
    echo Check status with: docker compose ps
)

endlocal
