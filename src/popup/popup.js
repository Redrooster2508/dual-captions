const DC = globalThis.DC;
const $ = (id) => document.getElementById(id);
const names = DC.namer([navigator.language, 'en']);

let settings = { ...DC.DEFAULTS };
let tabId = null;
let lastTracksSig = '';
let lastVarietySig = '';

// ------------------------------------------------------------ settings

function fillLangs(select, value) {
  const base = DC.baseOf(value);
  const codes = [...new Set([...DC.LANGS, base])].filter(Boolean);
  const opts = codes.map((c) => [c, names.base(c)]).sort((a, b) => a[1].localeCompare(b[1]));
  select.replaceChildren(...opts.map(([c, n]) => new Option(n, c, false, c === base)));
}

// The region under each language: Spain, Mexico, Puerto Rico…
function fillVariety(select, value) {
  const { base, sub } = DC.parseTag(value);
  const tag = DC.normTag(value);
  const opts = names.varieties(base);
  if (sub && !opts.some(([t]) => t === tag)) opts.push([tag, names.variety(tag)]);
  select.hidden = !opts.length;
  select.replaceChildren(new Option('Any region', base), ...opts.map(([t, n]) => new Option(n, t)));
  select.value = sub ? tag : base;
}

// What the translation engine can actually give for your variety.
function mtHint() {
  const tag = DC.normTag(settings.nativeLang);
  if (!DC.parseTag(tag).sub || settings.engine === 'none') return '';
  const deepl = DC.normTag(DC.deeplTarget(tag));
  if (settings.engine === 'builtin') {
    return `On-device translation is general ${names.base(tag)}` +
      (DC.parseTag(deepl).sub ? `; DeepL can do ${names.full(deepl)}.` : '.');
  }
  return deepl === tag ? '' : `DeepL has no ${names.full(tag)}, so translations are in ${names.full(deepl)}.`;
}

function showSettings() {
  $('enabled').checked = settings.enabled;
  fillLangs($('learnLang'), settings.learnLang);
  fillLangs($('nativeLang'), settings.nativeLang);
  fillVariety($('learnVariety'), settings.learnLang);
  fillVariety($('nativeVariety'), settings.nativeLang);
  $('fontScale').value = settings.fontScale;
  $('fontScaleOut').value = `${Math.round(settings.fontScale * 100)}%`;
  for (const id of ['pauseOnHover', 'autoPause', 'blur']) $(id).checked = settings[id];
  $('engine').value = settings.engine;
  $('deeplRow').hidden = settings.engine !== 'deepl';
  $('mtHint').textContent = mtHint();
  $('mtHint').hidden = !$('mtHint').textContent;
}

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.local.set({ settings });
  showSettings();
}

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
for (const id of ['learnLang', 'learnVariety']) $(id).addEventListener('change', (e) => save({ learnLang: e.target.value }));
for (const id of ['nativeLang', 'nativeVariety']) $(id).addEventListener('change', (e) => save({ nativeLang: e.target.value }));
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
  showVariety(st);
  status.textContent = st.status || '';
  status.hidden = !st.status;
}

// Where this video's language is from, when the subtitles don't say (or say wrong).
function showVariety(st) {
  const base = DC.baseOf(st.trackLang);
  const opts = names.varieties(base);
  $('varietyRow').hidden = !opts.length;
  const sig = JSON.stringify([st.trackLang, st.variety]);
  if (!opts.length || sig === lastVarietySig || document.activeElement === $('variety')) return;
  lastVarietySig = sig;
  const trackSub = DC.parseTag(st.trackLang).sub;
  $('varietyLabel').textContent = `Where this ${names.base(base)} is from`;
  $('variety').replaceChildren(
    new Option(trackSub ? `From the subtitles: ${names.variety(st.trackLang)}` : 'Not set', ''),
    ...opts.map(([t, n]) => new Option(n, t)),
  );
  $('variety').value = st.variety && DC.baseOf(st.variety) === base ? st.variety : '';
}
$('variety').addEventListener('change', async (e) => {
  try { showVideo(await chrome.tabs.sendMessage(tabId, { type: 'dc:setVariety', variety: e.target.value }, { frameId: 0 })); } catch {}
});

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
