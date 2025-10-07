import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fsPromises from 'fs/promises';
import mime from 'mime';
import { execa } from 'execa';
import ffprobe from 'ffprobe-static';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration

const COURSE_DIR = process.env.COURSE_DIR || path.join(__dirname, 'courses');
console.log(COURSE_DIR);
const PORT = Number(process.env.PORT || 4001);
const DURATION_CACHE_FILE = path.join(__dirname, '.duration-cache.json');
const PROGRESS_FILE = path.join(__dirname, '.progress.json');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.avi']);

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Simple health endpoint
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Utility: ensure course dir exists
function assertCourseDirExists() {
  if (!fs.existsSync(COURSE_DIR) || !fs.statSync(COURSE_DIR).isDirectory()) {
    const msg = `COURSE_DIR does not exist or is not a directory: ${COURSE_DIR}`;
    console.error(msg);
    throw new Error(msg);
  }
}

// Duration cache load/save
async function loadDurationCache() {
  try {
    const raw = await fsPromises.readFile(DURATION_CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_err) {
    return {};
  }
}

async function saveDurationCache(cache) {
  try {
    await fsPromises.writeFile(DURATION_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to save duration cache:', err);
  }
}

function encodeId(absPath) {
  const b = Buffer.from(absPath, 'utf8');
  // base64url is supported in Node 18+
  return typeof b.toString === 'function' ? b.toString('base64url') : b.toString('base64');
}

function decodeId(id) {
  try {
    const buf = Buffer.from(id, 'base64url');
    return buf.toString('utf8');
  } catch (_e) {
    // fallback for environments without base64url
    try {
      const buf2 = Buffer.from(id, 'base64');
      return buf2.toString('utf8');
    } catch (e2) {
      return '';
    }
  }
}

function stripExtension(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function leadingNumberValue(name) {
  // Capture leading number possibly followed by separators like '.', '-', ')', ' '
  const match = name.trim().match(/^(\d{1,6})[\s\.-_\)]?/);
  if (!match) return Number.MAX_SAFE_INTEGER; // items without leading numbers go last
  return parseInt(match[1], 10);
}

async function getVideoDurationSeconds(absPath, cache) {
  if (cache[absPath] && typeof cache[absPath].durationSec === 'number') {
    return cache[absPath].durationSec;
  }
  try {
    // Ask ffprobe for the container duration
    const { stdout } = await execa(ffprobe.path, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      absPath
    ]);
    const val = parseFloat(String(stdout).trim());
    const dur = Number.isFinite(val) ? val : 0;
    cache[absPath] = { durationSec: dur };
    return dur;
  } catch (err) {
    console.warn('ffprobe failed for', absPath, err?.shortMessage || err?.message || err);
    cache[absPath] = { durationSec: 0 };
    return 0;
  }
}

async function scanDirectoryRecursive(dirAbs, cache) {
  const entries = await fsPromises.readdir(dirAbs, { withFileTypes: true });
  // Sort using numeric prefixes, then by name
  entries.sort((a, b) => {
    const aVal = leadingNumberValue(a.name);
    const bVal = leadingNumberValue(b.name);
    if (aVal !== bVal) return aVal - bVal;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  const children = [];
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      const group = await scanDirectoryRecursive(abs, cache);
      if (group.children.length > 0) {
        children.push(group);
      }
      continue;
    }
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;
      const durationSec = await getVideoDurationSeconds(abs, cache);
      children.push({
        id: encodeId(abs),
        type: 'file',
        title: stripExtension(entry.name),
        pathAbs: abs,
        durationSec
      });
    }
  }

  // Compute group totals
  let total = 0;
  let videosCount = 0;
  for (const ch of children) {
    if (ch.type === 'file') {
      total += ch.durationSec || 0;
      videosCount += 1;
    } else if (ch.type === 'group') {
      total += ch.durationSec || 0;
      videosCount += ch.videosCount || 0;
    }
  }

  return {
    id: encodeId(dirAbs),
    type: 'group',
    title: path.basename(dirAbs),
    children,
    durationSec: total,
    videosCount
  };
}

async function buildCourseTree() {
  assertCourseDirExists();
  const cache = await loadDurationCache();
  const tree = await scanDirectoryRecursive(COURSE_DIR, cache);
  await saveDurationCache(cache);
  // Attach totals on root
  const totals = {
    totalDurationSec: tree.durationSec || 0,
    numVideos: tree.videosCount || 0
  };
  return { ...tree, totals };
}

// API to return tree
app.get('/api/course', async (_req, res) => {
  try {
    const tree = await buildCourseTree();
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Progress file helpers and API
async function loadProgress() {
  try {
    const raw = await fsPromises.readFile(PROGRESS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { completed: {}, lastPlayedId: null };
    return { completed: parsed.completed || {}, lastPlayedId: parsed.lastPlayedId || null };
  } catch (_e) {
    return { completed: {}, lastPlayedId: null };
  }
}

async function saveProgress(next) {
  const data = { completed: next.completed || {}, lastPlayedId: next.lastPlayedId || null };
  await fsPromises.writeFile(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

app.get('/api/progress', async (_req, res) => {
  try {
    const data = await loadProgress();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/progress', async (req, res) => {
  try {
    const { setCompleted, unsetCompleted, lastPlayedId } = req.body || {};
    const current = await loadProgress();
    const completed = { ...(current.completed || {}) };
    if (Array.isArray(setCompleted)) {
      for (const id of setCompleted) {
        if (typeof id === 'string' && id) completed[id] = true;
      }
    }
    if (Array.isArray(unsetCompleted)) {
      for (const id of unsetCompleted) {
        if (typeof id === 'string' && id) delete completed[id];
      }
    }
    const next = { completed, lastPlayedId: typeof lastPlayedId === 'string' ? lastPlayedId : current.lastPlayedId || null };
    const saved = await saveProgress(next);
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Video streaming endpoint with HTTP range support
app.get('/video/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const absPath = decodeId(id);
    if (!absPath || !absPath.startsWith(COURSE_DIR)) {
      return res.status(404).end();
    }
    const stat = await fsPromises.stat(absPath);
    if (!stat.isFile()) {
      return res.status(404).end();
    }
    const fileSize = stat.size;
    const contentType = mime.getType(absPath) || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start) || isNaN(end) || start > end) {
        return res.status(416).end();
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      const stream = fs.createReadStream(absPath, { start, end });
      stream.pipe(res);
      stream.on('error', () => res.end());
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      });
      const stream = fs.createReadStream(absPath);
      stream.pipe(res);
      stream.on('error', () => res.end());
    }
  } catch (err) {
    res.status(500).end();
  }
});

// Fallback to index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Serving course directory: ${COURSE_DIR}`);
});


