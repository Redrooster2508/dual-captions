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
    variety: '', // where this video's language is from, if you said ('es-PR')
    secLabel: '',
    status: '',
    failed: false,
    token: 0,
  };
  const cueCache = new Map(); // track id -> Promise<cues>
  let libIndex = new Map(); // key -> entry
  let libByWord = new Map(); // `${base language}|${word}` -> entries in every variety
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
  const same = (a, b) => DC.baseOf(a) === DC.baseOf(b);

  // The best track for a language variety: human subtitles before
  // auto-generated ones, then the closest variety (Puerto Rican Spanish
  // prefers es-PR, then Caribbean, then Latin American, then plain es), then
  // the site's own order.
  function bestFor(tracks, want) {
    return tracks
      .map((t) => ({ t, fit: DC.langFit(t.lang, want) }))
      .filter((x) => x.fit > 0)
      .sort((a, b) => (!!a.t.auto - !!b.t.auto) || (b.fit - a.fit) || byRank(a.t, b.t))[0]?.t || null;
  }

  function pickPrimary() {
    const tracks = allTracks();
    return bestFor(tracks, settings.learnLang) || tracks.slice().sort(byRank)[0] || null;
  }

  // Translate into your language, or into the one you're learning if the
  // subtitles are already in your language.
  const targetFor = (pt) => (pt && same(pt.lang, settings.nativeLang) ? settings.learnLang : settings.nativeLang);
  const sourceLang = (pt) => pt?.lang || DC.baseOf(settings.learnLang);

  // The subtitle line's language with its variety when known: what you set
  // for this video, else the track's own tag ('es-419'), else just 'es'.
  function lineLang() {
    const lang = DC.normTag(sourceLang(state.primary?.track));
    return state.variety && same(state.variety, lang) ? state.variety : lang;
  }

  // For pronunciation and dictionaries: the line's variety, or the one
  // you're learning when the video doesn't say.
  const assumedLang = (lang) =>
    (DC.parseTag(lang).sub || !same(lang, settings.learnLang) ? lang : settings.learnLang);

  function resolveSecondary(pt) {
    const mode = state.secondaryMode;
    if (mode === 'off') return {};
    if (mode.startsWith('track:')) {
      const t = findTrack(mode.slice(6));
      return t ? { track: t, label: t.label } : {};
    }
    const target = targetFor(pt);
    const mt = pt && settings.engine !== 'none' ? { from: sourceLang(pt), to: target } : null;
    const mtLabel = `Machine translation → ${DC.langName(DC.translate.outputLang(target, settings.engine))}`;
    if (mode === 'mt') return mt ? { mt, label: mtLabel } : { label: 'Machine translation is off (see Translation engine below)' };
    const human = bestFor(allTracks().filter((t) => t !== pt), target);
    if (human) return { track: human, label: human.label };
    const yt = pt && state.translationFor?.(pt, target);
    if (yt) return { track: yt, label: yt.label };
    if (mt) return { mt, label: mtLabel };
    return { label: `No ${DC.langName(DC.baseOf(target))} subtitles, and machine translation is off` };
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
    state.variety = '';
    if (key) loadVariety(key);
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
    overlay.setLines({ text: pCues.map((c) => c.text).join('\n'), lang: lineLang() }, sec, settings.blur);

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
  const names = DC.namer(['en']);
  const normWord = (word, lang) => (DC.baseOf(lang) === 'de' ? word : word.toLocaleLowerCase(lang || undefined));

  function indexLibrary(lib) {
    libIndex = new Map(Object.entries(lib));
    libByWord = new Map();
    for (const e of libIndex.values()) {
      const k = DC.library.keyOf(e.word, DC.baseOf(e.lang));
      libByWord.set(k, [...(libByWord.get(k) || []), e]);
    }
  }

  // The library entry for this word that fits the line's variety (the same
  // variety, or either one unspecified), and entries for other varieties.
  // "guagua" saved for Puerto Rico (bus) isn't the "guagua" of a Chilean film
  // (baby), so those count as different words.
  function saved(word, lang) {
    const all = libByWord.get(DC.library.keyOf(word, DC.baseOf(lang))) || [];
    const sub = DC.parseTag(lang).sub;
    const fits = (e) => !sub || !DC.parseTag(e.lang).sub || DC.normTag(e.lang) === DC.normTag(lang);
    const match = all.filter(fits).sort((a, b) => DC.langFit(b.lang, lang) - DC.langFit(a.lang, lang))[0] || null;
    return { match, others: all.filter((e) => e !== match) };
  }

  // Wiktionary marks regional senses in every language; for Spanish and
  // Portuguese, add a dictionary that lists usage by country.
  function dictLinks(word, lang) {
    const w = encodeURIComponent(normWord(word, lang));
    const anchor = encodeURIComponent(names.base(lang).replace(/ /g, '_'));
    const links = [['Wiktionary', `https://en.wiktionary.org/wiki/${w}#${anchor}`]];
    const base = DC.baseOf(lang), assumed = assumedLang(lang);
    if (base === 'es') {
      links.push(DC.sameGroup(assumed, 'es-419')
        ? ['Americanismos', `https://www.asale.org/damer/${w}`]
        : ['RAE', `https://dle.rae.es/${w}`]);
    }
    if (base === 'pt') links.push(['Priberam', `https://dicionario.priberam.org/${w}`]);
    return links;
  }

  function popupData(c) {
    const { match, others } = saved(c.word, c.lang);
    const base = DC.baseOf(c.lang);
    const trackSub = DC.parseTag(sourceLang(state.primary?.track)).sub;
    return {
      word: c.word,
      langLabel: names.base(c.lang),
      // Where this video's language is from; you can change it here.
      varieties: DC.VARIETIES[base] && {
        value: state.variety && same(state.variety, c.lang) ? state.variety : '',
        options: [
          ['', trackSub ? `From the subtitles: ${names.variety(sourceLang(state.primary.track))}` : 'Region not set'],
          ...names.varieties(base),
        ],
      },
      translation: match?.translation || c.translation || (settings.engine !== 'none' ? 'Translating…' : 'Turn on a translation engine in the popup to see meanings here.'),
      trState: match?.translation || c.translation ? 'done' : 'dim',
      entry: match,
      also: others.map((e) => ({ where: names.variety(e.lang) || 'no region', translation: e.translation })),
      links: dictLinks(c.word, c.lang),
    };
  }

  async function onWordClick(raw, span) {
    if (!video) return;
    holdPause('popup');
    const lang = lineLang();
    const word = normWord(raw, lang);
    const s = overlay.secondary;
    const sec = s.classList.contains('note') || s.classList.contains('action') ? '' : s.textContent;
    const ctx = popupCtx = { word, lang, sentence: overlay.lineText, sentenceTranslation: sec, time: video.currentTime, translation: '' };
    const data = popupData(ctx);
    overlay.showPopup(span, data);
    if (data.trState === 'done' || settings.engine === 'none') return;
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

  async function onPopupAction(act, value) {
    const c = popupCtx;
    if (!c) return;
    if (act === 'close') return closePopup();
    if (act === 'speak') return speak(c.word, assumedLang(c.lang));
    if (act === 'variety') {
      await setVariety(value);
      c.lang = lineLang();
      overlay.updatePopup(popupData(c));
      return;
    }
    let entry = saved(c.word, c.lang).match;
    try {
      if (act === 'add' || act === 'add-important') {
        entry = await DC.library.put({
          word: c.word, lang: c.lang, translation: c.translation, status: 'learning', important: act === 'add-important',
          sentence: c.sentence, sentenceTranslation: c.sentenceTranslation,
          source: { site: site.name, title: site.title(), url: site.shareUrl(c.time), time: c.time },
        });
        overlay.toast(`Added “${c.word}” to your library`);
      } else if (act.startsWith('status:') && entry) {
        entry = await DC.library.put({ key: entry.key, status: act.slice(7) });
      } else if (act === 'important' && entry) {
        entry = await DC.library.put({ key: entry.key, important: !entry.important });
      } else if (act === 'remove' && entry) {
        await DC.library.remove(entry.key);
        libIndex.delete(entry.key);
        entry = null;
        overlay.toast(`Removed “${c.word}”`);
      }
    } catch (e) {
      overlay.toast(e.message.includes('context invalidated') ? 'Extension was updated: reload this page' : e.message);
      return;
    }
    if (entry) libIndex.set(entry.key, entry);
    indexLibrary(Object.fromEntries(libIndex));
    overlay.markWords();
    overlay.updatePopup(popupData(c));
  }

  function speak(text, lang) {
    const u = new SpeechSynthesisUtterance(text);
    const voice = DC.pickVoice(lang);
    u.lang = voice?.lang || lang;
    if (voice) u.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // ------------------------------------------------------------ this video's variety

  // Remembered per video, in chrome.storage.local "varieties":
  // { [`${site}|${media key}`]: tag }, newest last.
  const VARIETIES = 'varieties';
  const varietyKey = (key) => `${site.name}|${key}`;

  async function loadVariety(key) {
    try {
      const { [VARIETIES]: map = {} } = await chrome.storage.local.get(VARIETIES);
      if (state.key === key) { state.variety = map[varietyKey(key)] || ''; kick(); }
    } catch {}
  }

  async function setVariety(tag) {
    state.variety = tag ? DC.normTag(tag) : '';
    kick();
    if (!state.key) return;
    try {
      const { [VARIETIES]: map = {} } = await chrome.storage.local.get(VARIETIES);
      const k = varietyKey(state.key);
      delete map[k];
      if (state.variety) map[k] = state.variety;
      const keys = Object.keys(map);
      for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete map[old];
      await chrome.storage.local.set({ [VARIETIES]: map });
    } catch {}
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
    if (msg.type === 'dc:setVariety') {
      setVariety(msg.variety).then(() => {
        if (popupCtx) { popupCtx.lang = lineLang(); overlay.updatePopup(popupData(popupCtx)); }
      });
    }
    if (msg.type === 'dc:getState' || msg.type === 'dc:select' || msg.type === 'dc:setVariety') {
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
        trackLang: state.primary ? DC.normTag(sourceLang(state.primary.track)) : '',
        variety: state.variety,
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
    indexLibrary(lib);
    overlay.markWords();
    if (popupCtx) overlay.updatePopup(popupData(popupCtx));
  });

  // ------------------------------------------------------------ start

  (async () => {
    try {
      const { settings: saved, library } = await chrome.storage.local.get(['settings', 'library']);
      settings = { ...DEFAULTS, ...saved };
      indexLibrary(library || {});
    } catch {}
    overlay.setLookup(saved);
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
