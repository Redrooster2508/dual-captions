// Subtitle parsers. Each returns cues sorted by start time:
//   [{ start: seconds, end: seconds, text: string }]
(() => {
  const DC = (globalThis.DC ??= {});

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '‎', rlm: '‏' };
  const decodeEntities = (s) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    });

  // Strip markup, decode entities, trim each line and drop empty ones.
  function cleanText(s, { tags = true } = {}) {
    if (tags) s = s.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '');
    return decodeEntities(s)
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
  }

  const sortCues = (cues) =>
    cues
      .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);

  // "01:02:03.456", "02:03,456", "1:02:03" -> seconds
  function clock(s) {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(String(s).trim());
    if (!m) return NaN;
    return +(m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4].padEnd(3, '0') / 1000 : 0);
  }

  // WebVTT and SRT share the same block structure.
  function parseVtt(text) {
    const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n(?:[ \t]*\n)+/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) continue;
      const [a, b = ''] = lines[i].split('-->');
      const start = clock(a);
      const end = clock(b.trim().split(/\s+/)[0]);
      const body = cleanText(lines.slice(i + 1).join('\n'));
      if (body) cues.push({ start, end, text: body });
    }
    return sortCues(cues);
  }

  function parseAss(text) {
    const time = (s) => {
      const m = /(\d+):(\d{2}):(\d{2})[.:](\d{2})/.exec(s || '');
      return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100 : NaN;
    };
    const cues = [];
    const seen = new Set();
    let format = null;
    let inEvents = false;
    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trim();
      if (/^\[.*\]$/.test(line)) { inEvents = /^\[events\]$/i.test(line); continue; }
      if (!inEvents) continue;
      if (/^format:/i.test(line)) { format = line.slice(7).split(',').map((s) => s.trim().toLowerCase()); continue; }
      if (!format || !/^dialogue:/i.test(line)) continue;
      const parts = line.slice(9).split(',');
      const f = {};
      format.forEach((name, i) => { f[name] = i === format.length - 1 ? parts.slice(i).join(',') : parts[i]; });
      const raw_text = String(f.text || '');
      if (/\{[^}]*\\p[1-9]/.test(raw_text)) continue; // vector drawings, not dialogue
      const body = cleanText(raw_text.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '));
      const cue = { start: time(f.start), end: time(f.end), text: body };
      const key = `${cue.start}|${cue.end}|${body}`;
      if (body && !seen.has(key)) { seen.add(key); cues.push(cue); }
    }
    return sortCues(cues);
  }

  // TTML / DFXP (Netflix's XML subtitle format).
  function parseTtml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read this TTML file');
    const tt = doc.documentElement;
    const mult = (tt.getAttribute('ttp:frameRateMultiplier') || '1 1').split(/\s+/).map(Number);
    const frameRate = (+tt.getAttribute('ttp:frameRate') || 30) * (mult[0] / mult[1] || 1);
    const tickRate = +tt.getAttribute('ttp:tickRate') || frameRate;
    const time = (s) => {
      if (!s) return NaN;
      s = s.trim();
      let m = /^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/.exec(s);
      if (m) return +m[1] * { h: 3600, m: 60, s: 1, ms: 0.001, f: 1 / frameRate, t: 1 / tickRate }[m[2]];
      m = /^(\d+):(\d{2}):(\d{2})(\.\d+)?(?::(\d+(?:\.\d+)?))?$/.exec(s);
      if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4] : 0) + (m[5] ? +m[5] / frameRate : 0);
      return NaN;
    };
    const textOf = (node) => {
      let out = '';
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue.replace(/\s+/g, ' ');
        else if (c.nodeType === 1) out += c.localName === 'br' ? '\n' : textOf(c);
      }
      return out;
    };
    const cues = [];
    for (const p of doc.getElementsByTagNameNS('*', 'p')) {
      let offset = 0;
      for (let a = p.parentElement; a; a = a.parentElement) offset += time(a.getAttribute('begin')) || 0;
      const start = offset + time(p.getAttribute('begin'));
      const end = p.hasAttribute('end') ? offset + time(p.getAttribute('end')) : start + time(p.getAttribute('dur'));
      const body = cleanText(textOf(p), { tags: false });
      if (body) cues.push({ start, end, text: body });
    }
    return sortCues(cues);
  }

  // YouTube's "json3" caption format.
  function parseJson3(text) {
    const events = JSON.parse(text).events || [];
    const rollUp = events.some((e) => e.aAppend);
    const cues = [];
    for (const e of events) {
      if (!e.segs || e.tStartMs == null || e.aAppend) continue;
      const body = cleanText(e.segs.map((s) => s.utf8 || '').join(''), { tags: false });
      if (body) cues.push({ start: e.tStartMs / 1000, end: (e.tStartMs + (e.dDurationMs || 0)) / 1000, text: body });
    }
    const sorted = sortCues(cues);
    // Auto-generated captions roll up: each line lingers while the next one
    // appears. Cut each line off where the next begins so one shows at a time.
    if (rollUp) {
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].end > sorted[i + 1].start) sorted[i].end = Math.max(sorted[i].start + 0.05, sorted[i + 1].start);
      }
    }
    return sorted;
  }

  // Pick a parser from the file name or, failing that, the content.
  function parseAuto(text, name = '') {
    const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
    const head = text.replace(/^﻿/, '').trimStart().slice(0, 200);
    if (ext === 'ass' || ext === 'ssa' || /^\[Script Info\]/i.test(head)) return parseAss(text);
    if (['ttml', 'dfxp', 'xml'].includes(ext) || head.startsWith('<')) return parseTtml(text);
    if (ext === 'json' || head.startsWith('{')) return parseJson3(text);
    return parseVtt(text); // WebVTT and SRT
  }

  // Subtitle files are often not UTF-8; guess a legacy encoding from the language.
  const LEGACY = {
    zh: 'gb18030', 'zh-Hant': 'big5', ja: 'shift_jis', ko: 'euc-kr', ru: 'windows-1251', uk: 'windows-1251',
    bg: 'windows-1251', ar: 'windows-1256', he: 'windows-1255', el: 'windows-1253', tr: 'windows-1254',
    pl: 'windows-1250', cs: 'windows-1250', hu: 'windows-1250', vi: 'windows-1258', th: 'windows-874',
  };
  async function readFile(file, langHint) {
    const buf = await file.arrayBuffer();
    const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {}
    return new TextDecoder(LEGACY[DC.baseLang?.(langHint)] || 'windows-1252').decode(buf);
  }

  // "Movie.2019.es.srt" -> "es", "show.pt-BR.vtt" -> "pt-BR"
  function langFromFilename(name) {
    const m = /[._\- ]([a-z]{2,3}(?:[-_][A-Za-z]{2,4})?)\.[a-z0-9]+$/i.exec(name);
    if (!m) return '';
    const code = m[1].replace('_', '-');
    try {
      return new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(code) ? code : '';
    } catch { return ''; }
  }

  // Cue lookup helpers.
  function lastStartedIndex(cues, t) {
    let lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  function activeCues(cues, t) {
    const i = lastStartedIndex(cues, t);
    const out = [];
    for (let j = i; j >= 0 && j > i - 8; j--) if (cues[j].end > t) out.unshift(cues[j]);
    return out;
  }

  DC.parse = { vtt: parseVtt, srt: parseVtt, ass: parseAss, ttml: parseTtml, json3: parseJson3, auto: parseAuto, cleanText, readFile, langFromFilename };
  DC.cues = { lastStartedIndex, active: activeCues };
})();
