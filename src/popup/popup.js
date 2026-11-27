const DC = globalThis.DC;
const $ = (id) => document.getElementById(id);
const names = new Intl.DisplayNames([navigator.language, 'en'], { type: 'language' });
const langName = (code) => { try { return names.of(code); } catch { return code; } };

let settings = { ...DC.DEFAULTS };
let tabId = null;
let lastTracksSig = '';

// ------------------------------------------------------------ settings

function fillLangs(select, value) {
  const codes = [...new Set([...DC.LANGS, value])].filter(Boolean);
  const opts = codes.map((c) => [c, langName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
  select.replaceChildren(...opts.map(([c, n]) => new Option(n, c, false, c === value)));
}

function showSettings() {
  $('enabled').checked = settings.enabled;
  fillLangs($('learnLang'), settings.learnLang);
  fillLangs($('nativeLang'), settings.nativeLang);
  $('fontScale').value = settings.fontScale;
  $('fontScaleOut').value = `${Math.round(settings.fontScale * 100)}%`;
  for (const id of ['pauseOnHover', 'autoPause', 'blur']) $(id).checked = settings[id];
  $('engine').value = settings.engine;
  $('deeplRow').hidden = settings.engine !== 'deepl';
}

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.local.set({ settings });
  showSettings();
}

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
$('learnLang').addEventListener('change', (e) => save({ learnLang: e.target.value }));
$('nativeLang').addEventListener('change', (e) => save({ nativeLang: e.target.value }));
$('fontScale').addEventListener('input', (e) => save({ fontScale: +e.target.value }));
for (const id of ['pauseOnHover', 'autoPause', 'blur']) {
  $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
}
$('engine').addEventListener('change', (e) => save({ engine: e.target.value }));
let keyTimer;
$('deeplKey').addEventListener('input', (e) => {
  clearTimeout(keyTimer);
  keyTimer = setTimeout(() => chrome.storage.local.set({ deeplKey: e.target.value.trim() }), 400);
});

// ------------------------------------------------------------ this video

async function refreshVideo() {
  let st = null;
  if (tabId != null) {
    try { st = await chrome.tabs.sendMessage(tabId, { type: 'dc:getState' }, { frameId: 0 }); } catch {}
  }
  showVideo(st);
}

function setTitle(text, empty) {
  $('title').textContent = text;
  $('title').title = empty ? '' : text;
  $('title').classList.toggle('empty', empty);
}

function showVideo(st) {
  const pickers = $('pickers');
  const status = $('status');
  if (!st) {
    setTitle("Not available on this page. If you opened this tab before installing Dual Captions, reload it.", true);
    pickers.hidden = status.hidden = true;
    return;
  }
  if (!st.key || !st.hasVideo) {
    setTitle(st.site === 'YouTube' || st.site === 'Netflix' ? 'Open a video to see its subtitles.' : 'No video on this page.', true);
    pickers.hidden = status.hidden = true;
    return;
  }
  setTitle(st.title || st.site, false);
  pickers.hidden = !st.tracks.length;

  const sig = JSON.stringify([st.tracks, st.primaryId, st.secondaryMode]);
  if (sig !== lastTracksSig && document.activeElement?.tagName !== 'SELECT') {
    lastTracksSig = sig;
    $('primary').replaceChildren(new Option('None', ''), ...st.tracks.map((t) => new Option(t.label, t.id)));
    $('primary').value = st.primaryId || '';
    $('secondary').replaceChildren(
      new Option('Auto: best available', 'auto'),
      new Option('Machine translation', 'mt'),
      ...st.tracks.map((t) => new Option(t.label, `track:${t.id}`)),
      new Option('Off', 'off'),
    );
    $('secondary').value = st.secondaryMode;
  }
  $('secondaryHint').textContent = st.secondaryLabel && st.secondaryMode === 'auto' ? `Using: ${st.secondaryLabel}` : '';
  $('secondaryHint').hidden = !$('secondaryHint').textContent;
  status.textContent = st.status || '';
  status.hidden = !st.status;
}

async function select(patch) {
  try { showVideo(await chrome.tabs.sendMessage(tabId, { type: 'dc:select', ...patch }, { frameId: 0 })); } catch {}
}
$('primary').addEventListener('change', (e) => select({ primaryId: e.target.value }));
$('secondary').addEventListener('change', (e) => select({ secondaryMode: e.target.value }));

// ------------------------------------------------------------ library

async function showLibraryCount() {
  const entries = Object.values(await DC.library.all());
  const important = entries.filter((e) => e.important).length;
  $('libCount').textContent = entries.length
    ? `· ${entries.length} word${entries.length === 1 ? '' : 's'}${important ? `, ${important} ★` : ''}`
    : '';
}
DC.library.onChange(showLibraryCount);
$('openLibrary').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/library/library.html') });
  window.close();
});

// ------------------------------------------------------------ start

(async () => {
  const stored = await chrome.storage.local.get(['settings', 'deeplKey']);
  settings = { ...DC.DEFAULTS, ...stored.settings };
  $('deeplKey').value = stored.deeplKey || '';
  showSettings();
  showLibraryCount();
  // ?tab=<id> lets the popup be opened as a page for a given tab (used in tests).
  const forced = new URLSearchParams(location.search).get('tab');
  if (forced) tabId = +forced;
  else tabId = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null;
  refreshVideo();
  setInterval(refreshVideo, 1000);
})();
