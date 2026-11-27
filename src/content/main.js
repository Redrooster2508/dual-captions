// The controller: picks subtitle tracks, draws the two caption lines in sync
// with the video, runs machine translation, keyboard shortcuts, the word popup
// and saving words to the library.
(() => {
  const DC = globalThis.DC;
  if (window.top !== window || DC.started) return;
  DC.started = true;

  const DEFAULTS = DC.DEFAULTS;
  const NO_SUBS = 'No subtitles found. Drop an .srt, .vtt or .ass file onto the page to add your own.';

  let settings = { ...DEFAULTS };
  const state = {
    key: null,
    tracksKnown: false,
    platformTracks: [],
    fileTracks: [],
    translationFor: null,
    userChose: false,
    primaryId: null,
    secondaryMode: 'auto', // 'auto' | 'mt' | 'off' | 'track:<id>'
    primary: null, // { track, cues }
    secondary: null, // { track, cues }
    mt: null, // machine translation of the primary line
    secLabel: '',
    status: '',
    failed: false,
    token: 0,
  };
  const cueCache = new Map(); // track id -> Promise<cues>
  let libIndex = new Map();
  let video = null;
  let fileSeq = 0;

  const ctrl = {
    tracksKnown: (key) => state.key === key && state.tracksKnown,
    setStatus,
    setTracks(key, tracks, opts = {}) {
      if (key !== state.key || (state.tracksKnown && !opts.replace)) return;
      for (const t of state.platformTracks) cueCache.delete(t.id);
      state.platformTracks = tracks;
      state.translationFor = opts.translationFor || null;
      state.tracksKnown = true;
      if (!state.userChose || !findTrack(state.primaryId)) state.primaryId = pickPrimary()?.id ?? null;
      applySelection();
    },
  };
  const site = DC.sites.create(ctrl);
  const overlay = new DC.Overlay({
    onWordClick, onPopupAction,
    onHover: (inside) => {
      if (!settings.pauseOnHover) return;
      inside ? holdPause('hover') : releasePause('hover');
    },
    onSecondaryAction: () => {
      // The click itself lets Chrome download the on-device translation model.
      if (!state.mt) return;
      state.mt.error = null;
      state.mt.lastIdx = null;
      kick();
    },
  });

  // ------------------------------------------------------------ tracks

  const allTracks = () => [...state.platformTracks, ...state.fileTracks];
  const findTrack = (id) => (id ? allTracks().find((t) => t.id === id) : null);
  const byRank = (a, b) => (a.rank || 0) - (b.rank || 0);
  const same = (a, b) => DC.baseLang(a) === DC.baseLang(b);

  function pickPrimary() {
    const tracks = allTracks();
    return tracks.filter((t) => same(t.lang, settings.learnLang)).sort(byRank)[0] || tracks.slice().sort(byRank)[0] || null;
  }

  // Translate into your language, or into the one you're learning if the
  // subtitles are already in your language.
  const targetFor = (pt) => (pt && same(pt.lang, settings.nativeLang) ? settings.learnLang : settings.nativeLang);
  const sourceLang = (pt) => pt?.lang || settings.learnLang;

  function resolveSecondary(pt) {
    const mode = state.secondaryMode;
    if (mode === 'off') return {};
    if (mode.startsWith('track:')) {
      const t = findTrack(mode.slice(6));
      return t ? { track: t, label: t.label } : {};
    }
    const target = targetFor(pt);
    const mt = pt && settings.engine !== 'none' ? { from: sourceLang(pt), to: target } : null;
    const mtLabel = `Machine translation → ${DC.langName(DC.baseLang(target))}`;
    if (mode === 'mt') return mt ? { mt, label: mtLabel } : { label: 'Machine translation is off (see Translation engine below)' };
    const human = allTracks().filter((t) => t !== pt && same(t.lang, target)).sort(byRank)[0];
    if (human) return { track: human, label: human.label };
    const yt = pt && state.translationFor?.(pt, target);
    if (yt) return { track: yt, label: yt.label };
    if (mt) return { mt, label: mtLabel };
    return { label: `No ${DC.langName(DC.baseLang(target))} subtitles, and machine translation is off` };
  }

  function newMT(from, to) {
    return { from, to, results: new Map(), queue: new Set(), inflight: new Set(), busy: false, error: null, errorAt: 0, lastIdx: null };
  }

  function loadCues(track) {
    if (!cueCache.has(track.id)) {
      const p = Promise.resolve().then(() => track.load()).then((cues) => {
        if (!cues.length) throw new Error(`"${track.label}" has no lines.`);
        return cues;
      });
      cueCache.set(track.id, p);
      p.catch(() => cueCache.delete(track.id));
    }
    return cueCache.get(track.id);
  }

  async function applySelection() {
    const token = ++state.token;
    const pt = findTrack(state.primaryId);
    const sec = resolveSecondary(pt);
    state.primary = pt ? { track: pt, cues: null } : null;
    state.secondary = sec.track ? { track: sec.track, cues: null } : null;
    state.mt = sec.mt ? newMT(sec.mt.from, sec.mt.to) : null;
    state.secLabel = sec.label || '';
    state.failed = false;
    overlay.closePopup();
    updateNativeHidden();
    if (!state.primary && !state.secondary) {
      setStatus(allTracks().length || !state.tracksKnown ? '' : NO_SUBS);
      return;
    }
    setStatus('Loading subtitles…');
    const errors = [];
    await Promise.all([state.primary, state.secondary].map(async (slot) => {
      if (!slot) return;
      try {
        const cues = await loadCues(slot.track);
        if (token === state.token) { slot.cues = cues; kick(); }
      } catch (e) {
        errors.push(e.message);
      }
    }));
    if (token !== state.token) return;
    state.failed = !state.primary?.cues && !state.secondary?.cues;
    updateNativeHidden();
    setStatus([...new Set(errors)].join(' '));
    kick();
  }

  function setStatus(msg) { state.status = msg; }

  function updateNativeHidden() {
    const on = settings.enabled && !!(state.primary || state.secondary) && !state.failed;
    if (site.nativeClass) document.documentElement.classList.toggle(site.nativeClass, on);
    site.setNativeHidden?.(on);
  }

  function onMediaChange(key) {
    state.key = key;
    state.token++;
    state.tracksKnown = false;
    state.platformTracks = [];
    state.translationFor = null;
    if (site.nativeClass) state.fileTracks = []; // files belong to the video they were dropped on
    state.userChose = false;
    state.primaryId = state.fileTracks[0]?.id ?? null;
    state.secondaryMode = 'auto';
    state.primary = state.secondary = state.mt = null;
    for (const id of [...cueCache.keys()]) if (!id.startsWith('file:')) cueCache.delete(id);
    overlay.clear();
    updateNativeHidden();
    setStatus(key ? 'Looking for subtitles…' : '');
    site.onMediaChange(key);
  }

  // ------------------------------------------------------------ rendering

  let rafId = 0;
  let autoPausedAt = null;
  const kick = () => { if (!rafId) rafId = requestAnimationFrame(frame); };
  function frame() {
    rafId = 0;
    if (render()) rafId = requestAnimationFrame(frame);
  }

  function render() {
    if (!settings.enabled || !video?.isConnected || !(state.primary || state.secondary)) { overlay.hide(); return false; }
    const r = video.getBoundingClientRect();
    const fs = document.fullscreenElement;
    if (site.isAd?.() || fs === video || r.width < 160 || r.height < 90 || r.bottom < 0 || r.top > innerHeight) {
      overlay.hide();
      return true;
    }
    overlay.show(fs || document.body || document.documentElement);
    overlay.place(r, site.bottomInset(video, r), settings.fontScale);

    const t = video.currentTime;
    const pCues = state.primary?.cues ? DC.cues.active(state.primary.cues, t) : [];
    let sec = { text: '', kind: 'text' };
    if (state.secondary?.cues) {
      sec.text = DC.cues.active(state.secondary.cues, t).map((c) => c.text).join('\n');
    } else if (state.mt && state.primary?.cues) {
      queueMT(DC.cues.lastStartedIndex(state.primary.cues, t));
      sec = mtLine(pCues);
    }
    overlay.setLines({ text: pCues.map((c) => c.text).join('\n'), lang: sourceLang(state.primary?.track) }, sec, settings.blur);

    // Pause at the end of each line so you can read it.
    const last = pCues[pCues.length - 1];
    if (settings.autoPause && last && !video.paused && last !== autoPausedAt && t >= last.end - 0.12) {
      autoPausedAt = last;
      site.pause(video);
    }
    return true;
  }

  function mtLine(pCues) {
    const mt = state.mt;
    if (!pCues.length) return { text: '', kind: 'text' };
    const parts = pCues.map((c) => mt.results.get(c.text));
    if (parts.every((p) => p != null)) return { text: parts.join('\n'), kind: 'text' };
    if (mt.error) return { text: mt.error.message, kind: mt.error.code === 'gesture' ? 'action' : 'note' };
    const dl = DC.translate.downloadProgress();
    return { text: dl != null && dl < 1 ? `Downloading translation model… ${Math.round(dl * 100)}%` : '…', kind: 'note' };
  }

  // Translate the current line and the next few ahead of time.
  function queueMT(idx) {
    const mt = state.mt;
    if (mt.error) {
      if (mt.error.code !== 'network' || Date.now() - mt.errorAt < 15000) return;
      mt.error = null;
    }
    if (idx === mt.lastIdx) return;
    mt.lastIdx = idx;
    const cues = state.primary.cues;
    for (let j = Math.max(0, idx - 1); j < Math.min(cues.length, idx + 12); j++) {
      const text = cues[j].text;
      if (!mt.results.has(text) && !mt.inflight.has(text)) mt.queue.add(text);
    }
    pumpMT();
  }

  async function pumpMT() {
    const mt = state.mt;
    if (!mt || mt.busy || !mt.queue.size) return;
    const batch = [...mt.queue].slice(0, settings.engine === 'deepl' ? 30 : 3);
    for (const t of batch) { mt.queue.delete(t); mt.inflight.add(t); }
    mt.busy = true;
    try {
      const out = await DC.translate.many(batch, mt.from, mt.to, settings.engine);
      batch.forEach((t, i) => mt.results.set(t, out[i] ?? ''));
    } catch (e) {
      mt.error = e;
      mt.errorAt = Date.now();
      mt.lastIdx = null;
      mt.queue.clear();
    } finally {
      for (const t of batch) mt.inflight.delete(t);
      mt.busy = false;
    }
    if (state.mt === mt && !mt.error) pumpMT();
  }

  // ------------------------------------------------------------ playback

  const pausedBy = new Set(); // why we paused: 'hover', 'popup'
  let resuming = false;
  function holdPause(reason) {
    if (!video) return;
    if (!video.paused) { pausedBy.add(reason); site.pause(video); }
    else if (pausedBy.size) pausedBy.add(reason);
  }
  function releasePause(reason) {
    if (!pausedBy.delete(reason) || pausedBy.size || !video) return;
    resuming = true;
    site.play(video);
    setTimeout(() => { resuming = false; }, 400);
  }

  function attachVideo(v) {
    video = v;
    if (v && !v.__dualcap) {
      v.__dualcap = true;
      v.addEventListener('play', () => { if (!resuming) pausedBy.clear(); });
      v.addEventListener('seeked', () => { autoPausedAt = null; kick(); });
    }
    updateNativeHidden();
  }

  function jump(which) {
    const cues = state.primary?.cues || state.secondary?.cues;
    if (!cues?.length || !video) return;
    const t = video.currentTime;
    const i = DC.cues.lastStartedIndex(cues, t + 0.05);
    const inside = i >= 0 && t < cues[i].end;
    const target = which === 'next' ? cues[i + 1]
      : which === 'prev' ? cues[Math.max(0, inside ? i - 1 : i)]
      : cues[Math.max(0, i)];
    if (!target) return;
    autoPausedAt = null;
    pausedBy.clear();
    overlay.closePopup();
    site.seek(video, target.start + 0.01);
    if (video.paused) site.play(video);
  }

  async function saveSettings(patch) {
    settings = { ...settings, ...patch };
    try { await chrome.storage.local.set({ settings }); } catch {}
  }

  const SHORTCUTS = {
    KeyA: () => jump('prev'),
    KeyR: () => jump('replay'),
    KeyD: () => jump('next'),
    KeyQ: () => { saveSettings({ autoPause: !settings.autoPause }); overlay.toast(`Pause after each line: ${settings.autoPause ? 'on' : 'off'}`); },
    KeyW: () => { saveSettings({ blur: !settings.blur }); overlay.toast(`Blur translation: ${settings.blur ? 'on' : 'off'}`); kick(); },
  };
  window.addEventListener('keydown', (e) => {
    if (!settings.enabled || !overlay.visible) return;
    if (e.code === 'Escape' && overlay.popupOpen) { closePopup(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !SHORTCUTS[e.code]) return;
    const target = e.composedPath()[0];
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    SHORTCUTS[e.code]();
  }, true);

  // ------------------------------------------------------------ words & library

  let popupCtx = null;
  const normWord = (word, lang) => (DC.baseLang(lang) === 'de' ? word : word.toLocaleLowerCase(lang || undefined));
  const lookup = (word, lang) => libIndex.get(DC.library.keyOf(word, DC.baseLang(lang)));

  function dictUrl(word, lang) {
    const base = DC.baseLang(lang);
    const anchor = DC.langName(base).replace(/ /g, '_');
    return `https://en.wiktionary.org/wiki/${encodeURIComponent(normWord(word, lang))}#${encodeURIComponent(anchor)}`;
  }

  async function onWordClick(raw, span) {
    if (!video) return;
    holdPause('popup');
    const lang = sourceLang(state.primary?.track);
    const word = normWord(raw, lang);
    const entry = lookup(word, lang);
    const s = overlay.secondary;
    const sec = s.classList.contains('note') || s.classList.contains('action') ? '' : s.textContent;
    popupCtx = { word, lang, sentence: overlay.lineText, sentenceTranslation: sec, time: video.currentTime, translation: entry?.translation || '' };
    const canTranslate = settings.engine !== 'none';
    overlay.showPopup(span, {
      word,
      langLabel: DC.langName(DC.baseLang(lang)),
      translation: entry?.translation || (canTranslate ? 'Translating…' : 'Turn on a translation engine in the popup to see meanings here.'),
      trState: entry?.translation ? 'done' : 'dim',
      entry,
      dictUrl: dictUrl(word, lang),
    });
    if (entry?.translation || !canTranslate) return;
    const ctx = popupCtx;
    try {
      const [tr] = await DC.translate.many([word], lang, targetFor(state.primary?.track), settings.engine, ctx.sentence);
      ctx.translation = tr;
      overlay.updatePopup({ word, translation: tr, trState: 'done' });
    } catch (e) {
      overlay.updatePopup({ word, translation: e.message, trState: 'dim' });
    }
  }

  function closePopup() {
    if (!overlay.popupOpen) return;
    overlay.closePopup();
    popupCtx = null;
    releasePause('popup');
  }

  async function onPopupAction(act) {
    const c = popupCtx;
    if (!c) return;
    if (act === 'close') return closePopup();
    if (act === 'speak') return speak(c.word, c.lang);
    const lang = DC.baseLang(c.lang);
    const key = DC.library.keyOf(c.word, lang);
    let entry = libIndex.get(key) || null;
    try {
      if (act === 'add' || act === 'add-important') {
        entry = await DC.library.put({
          word: c.word, lang, translation: c.translation, status: 'learning', important: act === 'add-important',
          sentence: c.sentence, sentenceTranslation: c.sentenceTranslation,
          source: { site: site.name, title: site.title(), url: site.shareUrl(c.time), time: c.time },
        });
        overlay.toast(`Added “${c.word}” to your library`);
      } else if (act.startsWith('status:') && entry) {
        entry = await DC.library.put({ key, status: act.slice(7) });
      } else if (act === 'important' && entry) {
        entry = await DC.library.put({ key, important: !entry.important });
      } else if (act === 'remove' && entry) {
        await DC.library.remove(key);
        entry = null;
        overlay.toast(`Removed “${c.word}”`);
      }
    } catch (e) {
      overlay.toast(e.message.includes('context invalidated') ? 'Extension was updated: reload this page' : e.message);
      return;
    }
    libIndex.set(key, entry);
    if (!entry) libIndex.delete(key);
    overlay.markWords();
    overlay.updatePopup({ entry });
  }

  function speak(text, lang) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = speechSynthesis.getVoices().find((v) => same(v.lang, lang));
    if (voice) u.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  window.addEventListener('pointerdown', (e) => { if (overlay.popupOpen && !overlay.contains(e)) closePopup(); }, true);

  // ------------------------------------------------------------ subtitle files

  const SUB_FILE = /\.(srt|vtt|ass|ssa|ttml|dfxp|xml)$/i;
  window.addEventListener('dragover', (e) => {
    if (settings.enabled && video && e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  }, true);
  window.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => SUB_FILE.test(f.name));
    if (!settings.enabled || !video || !files.length) return;
    e.preventDefault();
    e.stopPropagation();
    (async () => { for (const f of files) await addFile(f); })();
  }, true);

  async function addFile(file) {
    const guess = DC.parse.langFromFilename(file.name);
    let cues;
    try {
      cues = DC.parse.auto(await DC.parse.readFile(file, guess || settings.learnLang), file.name);
    } catch (e) {
      overlay.toast(`Couldn't read ${file.name}`);
      return;
    }
    if (!cues.length) { overlay.toast(`No subtitles found in ${file.name}`); return; }
    const track = { id: `file:${++fileSeq}`, label: `${file.name} (file)`, lang: guess, rank: 0, load: async () => cues };
    state.fileTracks.push(track);
    state.userChose = true;
    const asPrimary = guess && same(guess, settings.nativeLang) ? false
      : guess && same(guess, settings.learnLang) ? true
      : !findTrack(state.primaryId);
    if (asPrimary) state.primaryId = track.id;
    else state.secondaryMode = `track:${track.id}`;
    await applySelection();
    overlay.toast(`${file.name} → ${asPrimary ? 'subtitle' : 'translation'} line`);
  }

  // ------------------------------------------------------------ popup & settings

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === 'dc:select') {
      state.userChose = true;
      if ('primaryId' in msg) state.primaryId = msg.primaryId || null;
      if ('secondaryMode' in msg) state.secondaryMode = msg.secondaryMode;
      applySelection();
    }
    if (msg.type === 'dc:getState' || msg.type === 'dc:select') {
      reply({
        site: site.name,
        hasVideo: !!video,
        key: state.key,
        title: state.key && video ? site.title() : '',
        tracksKnown: state.tracksKnown,
        tracks: allTracks().map((t) => ({ id: t.id, label: t.label, lang: t.lang })),
        primaryId: state.primaryId,
        secondaryMode: state.secondaryMode,
        secondaryLabel: state.secLabel,
        status: state.status || (state.tracksKnown && !allTracks().length ? NO_SUBS : ''),
      });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.deeplKey && state.mt) state.mt = newMT(state.mt.from, state.mt.to);
    if (!changes.settings) return;
    const prev = settings;
    settings = { ...DEFAULTS, ...changes.settings.newValue };
    if (prev.engine !== settings.engine) DC.translate.reset();
    if (prev.learnLang !== settings.learnLang || prev.nativeLang !== settings.nativeLang || prev.engine !== settings.engine) {
      if (!state.userChose) state.primaryId = pickPrimary()?.id ?? null;
      if (state.tracksKnown || state.fileTracks.length) applySelection();
    }
    if (!settings.enabled) closePopup();
    updateNativeHidden();
    kick();
  });

  DC.library.onChange((lib) => {
    libIndex = new Map(Object.entries(lib));
    overlay.markWords();
  });

  // ------------------------------------------------------------ start

  (async () => {
    try {
      const { settings: saved, library } = await chrome.storage.local.get(['settings', 'library']);
      settings = { ...DEFAULTS, ...saved };
      libIndex = new Map(Object.entries(library || {}));
    } catch {}
    overlay.setLookup(lookup);
    const tick = () => {
      const key = site.mediaKey();
      if (key !== state.key) onMediaChange(key);
      const v = site.findVideo();
      if (v !== video) attachVideo(v);
      if (video && settings.enabled && (state.primary || state.secondary)) kick();
    };
    tick();
    setInterval(tick, 500);
  })();
})();
