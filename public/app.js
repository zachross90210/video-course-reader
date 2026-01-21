const state = {
  tree: null,
  selectedId: null,
  completed: {},
  playbackPositions: {},
  progressLoaded: false,
  selectedCourseId: null,
  savePositionTimer: null
};

async function loadProgressFromServer() {
  const res = await fetch('/api/progress');
  if (!res.ok) throw new Error('Failed to load progress');
  const data = await res.json();
  state.completed = data.completed || {};
  state.playbackPositions = data.playbackPositions || {};
  state.progressLoaded = true;
  return data;
}

async function saveProgressToServer({ setCompleted = [], unsetCompleted = [], lastPlayedId = undefined, playbackPositions = undefined }) {
  const res = await fetch('/api/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setCompleted, unsetCompleted, lastPlayedId, playbackPositions })
  });
  if (!res.ok) throw new Error('Failed to save progress');
  const data = await res.json();
  state.completed = data.completed || state.completed;
  state.playbackPositions = data.playbackPositions || state.playbackPositions;
  return data;
}

function setLastPlayed(id) {
  // also post to server in background
  saveProgressToServer({ lastPlayedId: id }).catch(() => {});
}

async function getLastPlayed() {
  try {
    const data = await loadProgressFromServer();
    return data.lastPlayedId || null;
  } catch (_e) { return null; }
}

function formatDuration(sec) {
  const s = Math.floor(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const two = n => String(n).padStart(2, '0');
  if (h > 0) return `${two(h)}:${two(m)}:${two(r)}`;
  return `${two(m)}:${two(r)}`;
}

async function fetchTree() {
  const res = await fetch('/api/course');
  if (!res.ok) throw new Error('Failed to load course');
  return await res.json();
}

function buildItemRow(item, depth) {
  const row = document.createElement('div');
  row.className = `row depth-${depth}`;

  if (item.type === 'file') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'complete-box';
    checkbox.checked = !!state.completed[item.id];
    checkbox.addEventListener('change', async () => {
      if (checkbox.checked) {
        state.completed[item.id] = true;
        // Clear playback position when marked as watched
        delete state.playbackPositions[item.id];
        await saveProgressToServer({ setCompleted: [item.id] }).catch(() => {});
      } else {
        delete state.completed[item.id];
        await saveProgressToServer({ unsetCompleted: [item.id] }).catch(() => {});
      }
      updateProgressBadges();
    });

    const playBtn = document.createElement('button');
    playBtn.className = 'play';
    playBtn.textContent = '▶';
    playBtn.title = 'Play';
    playBtn.addEventListener('click', () => selectAndPlay(item.id));

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.title;
    title.addEventListener('click', () => selectAndPlay(item.id));

    const dur = document.createElement('span');
    dur.className = 'duration';
    dur.textContent = formatDuration(item.durationSec);

    row.appendChild(checkbox);
    row.appendChild(playBtn);
    row.appendChild(title);
    row.appendChild(dur);

    row.dataset.id = item.id;
  }

  return row;
}

function buildItemNode(item, depth) {
  if (item.type === 'group') {
    return buildGroupNode(item, depth);
  }
  const container = document.createElement('div');
  container.className = 'item';
  container.appendChild(buildItemRow(item, depth));
  return container;
}

function buildGroupNode(item, depth) {
  const container = document.createElement('div');
  container.className = 'item group-frame';

  const header = document.createElement('div');
  header.className = `row depth-${depth}`;

  const toggle = document.createElement('button');
  toggle.className = 'toggle';
  toggle.textContent = '▾';
  toggle.title = 'Collapse/Expand';

  const title = document.createElement('span');
  title.className = 'title group-title';
  title.textContent = item.title;

  header.appendChild(toggle);
  header.appendChild(title);

  const childrenWrap = document.createElement('div');
  childrenWrap.className = 'children';
  for (const child of item.children || []) {
    childrenWrap.appendChild(buildItemNode(child, depth + 1));
  }

  toggle.addEventListener('click', () => {
    const collapsed = childrenWrap.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▸' : '▾';
  });

  container.appendChild(header);
  container.appendChild(childrenWrap);
  return container;
}

function renderContentsForCourse(courseNode) {
  const root = document.getElementById('contents');
  root.innerHTML = '';
  for (const child of courseNode.children || []) {
    root.appendChild(buildItemNode(child, 0));
  }
  const totalVideos = courseNode.videosCount ?? courseNode.totals?.numVideos ?? 0;
  const totalDuration = courseNode.durationSec ?? courseNode.totals?.totalDurationSec ?? 0;
  document.getElementById('totalVideos').textContent = String(totalVideos || 0);
  document.getElementById('totalDuration').textContent = formatDuration(totalDuration || 0);
  const courseNameEl = document.getElementById('courseName');
  if (courseNameEl) courseNameEl.textContent = courseNode?.title || '';
  updateProgressBadges();
  // Update watched/left aggregates for selected course
  const cp = computeCourseProgress(courseNode);
  const watchedEl = document.getElementById('watchedDuration');
  const leftEl = document.getElementById('leftDuration');
  if (watchedEl) watchedEl.textContent = formatDuration(cp.watchedSec);
  if (leftEl) leftEl.textContent = formatDuration(cp.leftSec);
}

function getTopLevelCourses(tree) {
  const groups = (tree.children || []).filter(ch => ch.type === 'group');
  if (groups.length > 0) return groups;
  // If no top-level groups, treat root as one course
  return [tree];
}

function populateCourseSelect(tree) {
  const select = document.getElementById('courseSelect');
  const courses = getTopLevelCourses(tree);
  select.innerHTML = '';
  for (const course of courses) {
    const opt = document.createElement('option');
    opt.value = course.id;
    opt.textContent = course.title;
    select.appendChild(opt);
  }
  // Hide picker if single course
  const picker = select.parentElement?.parentElement || select.parentElement;
  if (courses.length <= 1) {
    if (picker) picker.style.display = 'none';
    state.selectedCourseId = courses[0].id;
  } else {
    if (picker) picker.style.display = '';
    state.selectedCourseId = state.selectedCourseId || courses[0].id;
    select.value = state.selectedCourseId;
  }
  select.onchange = () => {
    state.selectedCourseId = select.value;
    const courseNode = courses.find(c => c.id === state.selectedCourseId) || courses[0];
    renderContentsForCourse(courseNode);
    autoSelectInitial(courseNode);
  };
  const initial = courses.find(c => c.id === state.selectedCourseId) || courses[0];
  renderContentsForCourse(initial);
  return initial;
}

function updateProgressBadges() {
  const container = document.getElementById('contents');
  const groupNodes = container.querySelectorAll('.item > .row .group-info');
  for (const gi of groupNodes) {
    // Traverse to children div
    const row = gi.parentElement;
    const childrenWrap = row.parentElement.querySelector(':scope > .children');
    const videoRows = childrenWrap ? childrenWrap.querySelectorAll('.row[data-id]') : [];
    let total = 0, completed = 0, seconds = 0, completedSec = 0, leftSec = 0;
    for (const vr of videoRows) {
      total += 1;
      const id = vr.dataset.id;
      const durationText = vr.querySelector('.duration')?.textContent || '00:00';
      // Parse duration text back to seconds roughly (hh:mm:ss or mm:ss)
      const secs = parseDuration(durationText);
      seconds += secs;
      if (state.completed[id]) {
        completed += 1;
        completedSec += secs;
      } else {
        leftSec += secs;
      }
    }
    gi.textContent = `${completed}/${total} • ${formatDuration(seconds)}`;
  }
}

function computeCourseProgress(node) {
  const acc = { watchedSec: 0, leftSec: 0, totalVideos: 0, completedVideos: 0 };
  function walk(n) {
    if (!n) return;
    if (n.type === 'file') {
      const secs = Math.floor(n.durationSec || 0);
      acc.totalVideos += 1;
      if (state.completed[n.id]) {
        acc.completedVideos += 1;
        acc.watchedSec += secs;
      } else {
        acc.leftSec += secs;
      }
      return;
    }
    for (const ch of n.children || []) walk(ch);
  }
  walk(node);
  return acc;
}

function parseDuration(text) {
  const parts = String(text).trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

async function selectAndPlay(id) {
  // Stop saving position for previous video
  if (state.savePositionTimer) {
    clearInterval(state.savePositionTimer);
    state.savePositionTimer = null;
  }
  
  // Remove old event listeners
  const video = document.getElementById('video');
  const oldSaveOnChange = video._saveOnChange;
  if (oldSaveOnChange) {
    video.removeEventListener('pause', oldSaveOnChange);
    video.removeEventListener('seeked', oldSaveOnChange);
    video._saveOnChange = null;
  }
  
  state.selectedId = id;
  setLastPlayed(id);
  
  // Get saved position before loading new video
  const savedPosition = state.playbackPositions[id];
  
  video.src = `/video/${encodeURIComponent(id)}`;
  await maybeAttachSubtitleTrack(id);
  
  // Restore playback position after metadata is loaded
  const restorePosition = () => {
    if (savedPosition && typeof savedPosition === 'number' && savedPosition > 0) {
      video.currentTime = savedPosition;
    }
  };
  
  video.addEventListener('loadedmetadata', restorePosition, { once: true });
  
  // Set up position saving for this video
  setupPositionSaving(id, video);
  
  await video.play().catch(() => {});
  highlightSelection();
  // Update video title
  const courseNode = getSelectedCourseNode();
  const fileNode = courseNode ? findNodeById(courseNode, id) : null;
  const vt = document.getElementById('videoTitle');
  if (vt) vt.textContent = fileNode?.title || '';
}

function setupPositionSaving(videoId, videoElement) {
  // Clear any existing timer
  if (state.savePositionTimer) {
    clearInterval(state.savePositionTimer);
  }
  
  let lastSavedTime = 0;
  let lastServerSaveTime = 0;
  const SERVER_SAVE_INTERVAL = 15000; // Save to server every 15 seconds
  
  // Update position in memory every 5 seconds
  state.savePositionTimer = setInterval(() => {
    if (videoElement && !videoElement.paused && videoElement.currentTime > 0) {
      const currentTime = Math.floor(videoElement.currentTime);
      // Only save if position is meaningful (more than 5 seconds) and changed
      if (currentTime > 5 && currentTime !== lastSavedTime) {
        state.playbackPositions[videoId] = currentTime;
        lastSavedTime = currentTime;
        
        // Save to server every 15 seconds to reduce load
        const now = Date.now();
        if (now - lastServerSaveTime >= SERVER_SAVE_INTERVAL) {
          lastServerSaveTime = now;
          saveProgressToServer({ playbackPositions: { [videoId]: currentTime } }).catch(() => {});
        }
      }
    }
  }, 5000);
  
  // Also save on pause/seek (immediate save to server)
  const saveOnChange = () => {
    if (videoElement && videoElement.currentTime > 5) {
      const currentTime = Math.floor(videoElement.currentTime);
      state.playbackPositions[videoId] = currentTime;
      lastSavedTime = currentTime;
      lastServerSaveTime = Date.now();
      saveProgressToServer({ playbackPositions: { [videoId]: currentTime } }).catch(() => {});
    }
  };
  
  videoElement.addEventListener('pause', saveOnChange);
  videoElement.addEventListener('seeked', saveOnChange);
  videoElement._saveOnChange = saveOnChange; // Store reference for cleanup
  
  // Clean up on video end
  const cleanup = () => {
    if (state.savePositionTimer) {
      clearInterval(state.savePositionTimer);
      state.savePositionTimer = null;
    }
    if (videoElement._saveOnChange) {
      videoElement.removeEventListener('pause', videoElement._saveOnChange);
      videoElement.removeEventListener('seeked', videoElement._saveOnChange);
      videoElement._saveOnChange = null;
    }
  };
  
  videoElement.addEventListener('ended', cleanup, { once: true });
}

function highlightSelection() {
  const nodes = document.querySelectorAll('.row[data-id]');
  nodes.forEach(n => {
    if (n.dataset.id === state.selectedId) n.classList.add('active'); else n.classList.remove('active');
  });
}

async function autoSelectInitial(tree) {
  const last = await getLastPlayed();
  if (last) return selectAndPlay(last);
  // Choose first uncompleted, else first
  const firstVideo = document.querySelector('.row[data-id]');
  const all = Array.from(document.querySelectorAll('.row[data-id]'));
  const uncompleted = all.find(el => !state.completed[el.dataset.id]);
  if (uncompleted) return selectAndPlay(uncompleted.dataset.id);
  if (firstVideo) return selectAndPlay(firstVideo.dataset.id);
}

async function main() {
  const video = document.getElementById('video');
  video.addEventListener('ended', async () => {
    if (state.selectedId) {
      state.completed[state.selectedId] = true;
      // Clear playback position when video ends (marked as completed)
      delete state.playbackPositions[state.selectedId];
      await saveProgressToServer({ setCompleted: [state.selectedId], lastPlayedId: state.selectedId }).catch(() => {});
      // update checkbox if exists
      const row = document.querySelector(`.row[data-id="${state.selectedId}"] input.complete-box`);
      if (row) row.checked = true;
      updateProgressBadges();
    }
    // Autoplay next item
    const items = Array.from(document.querySelectorAll('.row[data-id]'));
    const idx = items.findIndex(n => n.dataset.id === state.selectedId);
    if (idx >= 0 && idx + 1 < items.length) {
      selectAndPlay(items[idx + 1].dataset.id);
    }
  });

  // no separate checkbox; rely on native captions toggle in the player

  // Load saved progress before rendering so checkboxes and badges reflect it
  await loadProgressFromServer().catch(() => {});
  state.tree = await fetchTree();
  const selectedCourse = populateCourseSelect(state.tree);
  await autoSelectInitial(selectedCourse);
}

async function maybeAttachSubtitleTrack(id) {
  const video = document.getElementById('video');
  // Remove existing tracks first
  const tracks = Array.from(video.querySelectorAll('track'));
  for (const t of tracks) t.remove();
  try {
    const res = await fetch(`/subtitle/${encodeURIComponent(id)}`, { method: 'HEAD' });
    if (!res.ok) return; // no subs
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = 'Subtitles';
    track.srclang = 'en';
    track.src = `/subtitle/${encodeURIComponent(id)}`;
    track.default = true;
    video.appendChild(track);
    // Let the user toggle via the player's native captions menu
  } catch (_e) {}
}

function getSelectedCourseNode() {
  if (!state.tree) return null;
  const courses = getTopLevelCourses(state.tree);
  return courses.find(c => c.id === state.selectedCourseId) || courses[0] || null;
}

function findNodeById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const ch of node.children || []) {
    const found = findNodeById(ch, id);
    if (found) return found;
  }
  return null;
}

main().catch(err => {
  console.error(err);
  alert('Failed to load course. Check the server logs.');
});


