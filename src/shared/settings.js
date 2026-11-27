// Default settings and language helpers, shared by the content script, the
// popup, the library page and the background worker. Saved values live in
// chrome.storage.local under "settings" (the DeepL key is stored on its own
// under "deeplKey" and only read by the background worker).
//
// Languages are BCP 47 tags. A tag with a region (or, for Chinese, a script)
// names a regional variety, like 'es-MX', 'pt-PT' or 'zh-Hant' (or Valencian
// Catalan, 'ca-ES-valencia', normalised to 'ca-valencia'); a bare tag like
// 'es' means any variety.
(() => {
  const DC = (globalThis.DC ??= {});

  // Old codes some sites still use, and codes that name a variety of a
  // language listed here (Dari is Persian as spoken in Afghanistan).
  const ALIASES = { iw: 'he', in: 'id', ji: 'yi', jw: 'jv', no: 'nb', fil: 'tl', mo: 'ro', prs: 'fa-AF', pes: 'fa-IR' };

  // Varieties offered in the popup, by language. Regions in the same group
  // use the language in similar ways (Latin American Spanish, European
  // Portuguese…); "near" lists the closest other regions first. Both decide
  // which subtitles, voices and translations come nearest when there's no
  // exact match, so tracks tagged with regions not offered here still work.
  DC.VARIETIES = {
    es: {
      offer: 'ES MX US PR CU DO CO VE PE CL AR 419',
      groups: ['ES', '419 MX US PR CU DO CO VE PE CL AR UY PY BO EC GT HN SV NI CR PA'],
      near: { MX: 'US 419', US: 'MX 419', PR: 'DO CU VE US', CU: 'PR DO', DO: 'PR CU', VE: 'CO DO PR', CO: 'VE', AR: 'UY PY', CL: 'AR PE', PE: 'BO EC', 419: 'MX US' },
    },
    pt: { offer: 'BR PT AO MZ', groups: ['BR', 'PT AO MZ CV GW ST TL'], near: { AO: 'PT', MZ: 'PT' } },
    en: {
      offer: 'US GB CA AU NZ IE IN ZA',
      groups: ['US CA', 'GB IE AU NZ IN ZA NG SG'],
      near: { CA: 'US', AU: 'NZ GB', NZ: 'AU GB', IE: 'GB', IN: 'GB', ZA: 'GB' },
    },
    fr: { offer: 'FR CA BE CH', groups: ['CA', 'FR BE CH LU MC'], near: { BE: 'FR', CH: 'FR' } },
    de: { offer: 'DE AT CH', groups: ['DE AT CH LI LU'], near: { AT: 'DE', CH: 'LI DE' } },
    nl: { offer: 'NL BE', groups: ['NL SR', 'BE'] },
    zh: { offer: 'Hans Hant HK', groups: ['Hans CN SG MY', 'Hant TW HK MO'], near: { Hans: 'CN', Hant: 'TW', HK: 'MO Hant' } },
    ar: { offer: 'EG SA AE LB SY JO PS IQ MA DZ TN', groups: ['EG SD', 'SA AE KW QA BH OM YE', 'LB SY JO PS', 'IQ', 'MA DZ TN LY'] },
    // Valencian has its own variant subtag; ca-ES is labelled Catalonia since
    // Valencia is told apart. Balearic has no standard tag.
    ca: {
      offer: 'ES valencia AD', groups: ['ES valencia AD FR IT'], near: { valencia: 'ES', AD: 'ES', ES: 'AD' },
      labels: { ES: 'Catalonia', valencia: 'Valencia' },
    },
    fa: { offer: 'IR AF', groups: ['IR', 'AF'] },
  };

  // 'es_mx' -> { base: 'es', sub: 'MX' }. sub is a variant listed in
  // DC.VARIETIES ('valencia'), else the region, else the script.
  function parseTag(tag) {
    const parts = String(tag || '').trim().replace(/_/g, '-').split('-').filter(Boolean);
    const first = (parts.shift() || '').toLowerCase();
    const [base, aliasSub = ''] = (ALIASES[first] || first).split('-');
    let region = '', script = '', variant = '';
    for (const p of parts) {
      if (/^([a-z]{2}|\d{3})$/i.test(p)) region ||= p.toUpperCase();
      else if (/^[a-z]{4}$/i.test(p)) script ||= p[0].toUpperCase() + p.slice(1).toLowerCase();
      else if (/^[a-z]{5,8}$/i.test(p) && groupOf(base, p.toLowerCase()) >= 0) variant ||= p.toLowerCase();
    }
    return { base, sub: variant || region || script || aliasSub };
  }
  const normTag = (tag) => { const { base, sub } = parseTag(tag); return sub ? `${base}-${sub}` : base; };
  const baseOf = (tag) => parseTag(tag).base;

  const groupOf = (base, sub) => DC.VARIETIES[base]?.groups.findIndex((g) => g.split(' ').includes(sub)) ?? -1;

  // How well something in language `have` (a subtitle track, a voice, a
  // translation) suits someone who wants `want`. 0 means another language.
  function langFit(have, want) {
    const h = parseTag(have), w = parseTag(want);
    if (!h.base || h.base !== w.base) return 0;
    if (h.sub === w.sub) return 100;
    if (!w.sub) return 60;
    const near = (DC.VARIETIES[w.base]?.near?.[w.sub] || '').split(' ');
    if (h.sub && near.includes(h.sub)) return 90 - near.indexOf(h.sub);
    const g = groupOf(w.base, w.sub);
    if (g >= 0 && g === groupOf(h.base, h.sub)) return 70;
    return h.sub ? 20 : 50; // a plain tag beats a different region
  }
  const sameGroup = (a, b) => langFit(a, b) >= 70;

  // The closest variety the popup offers: the tag itself, else the first
  // offered region in its group, else the bare language.
  function offeredTag(tag) {
    const { base, sub } = parseTag(tag);
    const v = DC.VARIETIES[base];
    if (!v || !sub) return base;
    const offer = v.offer.split(' ');
    if (offer.includes(sub)) return `${base}-${sub}`;
    const g = groupOf(base, sub);
    const alt = g >= 0 && v.groups[g].split(' ').find((s) => offer.includes(s));
    return alt ? `${base}-${alt}` : base;
  }

  // Names for tags in the given UI languages: base('es-PR') -> "Spanish",
  // variety('es-PR') -> "Puerto Rico", full('es-PR') -> "Spanish (Puerto Rico)".
  const LABELS = { Hans: 'Simplified', Hant: 'Traditional' };
  function namer(locales = ['en']) {
    const safe = (names) => (code) => { try { return names.of(code) || code; } catch { return code; } };
    const lang = safe(new Intl.DisplayNames(locales, { type: 'language' }));
    const region = safe(new Intl.DisplayNames(locales, { type: 'region' }));
    const sub = (base, s) => DC.VARIETIES[base]?.labels?.[s] || LABELS[s] || region(s);
    const n = {
      base: (tag) => lang(baseOf(tag)),
      variety: (tag) => { const t = parseTag(tag); return t.sub ? sub(t.base, t.sub) : ''; },
      full: (tag) => { const t = parseTag(tag); return t.sub ? `${n.base(tag)} (${sub(t.base, t.sub)})` : n.base(tag); },
      // [[tag, name]] for the popup, sorted by name
      varieties: (base) => (DC.VARIETIES[base]?.offer.split(' ') || [])
        .map((s) => [`${base}-${s}`, sub(base, s)]).sort((a, b) => a[1].localeCompare(b[1])),
    };
    return n;
  }

  // The DeepL code that comes closest to a target variety.
  function deeplTarget(tag) {
    const base = baseOf(tag);
    if (base === 'en') return sameGroup(tag, 'en-GB') ? 'EN-GB' : 'EN-US';
    if (base === 'pt') return sameGroup(tag, 'pt-PT') ? 'PT-PT' : 'PT-BR';
    if (base === 'es') return sameGroup(tag, 'es-419') ? 'ES-419' : 'ES';
    if (base === 'zh') return sameGroup(tag, 'zh-Hant') ? 'ZH-HANT' : 'ZH-HANS';
    return base.toUpperCase();
  }

  // The installed voice that best fits a variety (Mexican Spanish for es-MX…).
  function pickVoice(tag) {
    let best = null, score = 0;
    for (const v of globalThis.speechSynthesis?.getVoices() || []) {
      const s = langFit(v.lang, tag);
      if (s > score) { best = v; score = s; }
    }
    return best;
  }

  Object.assign(DC, { parseTag, normTag, baseOf, langFit, sameGroup, offeredTag, namer, deeplTarget, pickVoice });

  const ui = normTag(chrome.i18n.getUILanguage() || 'en');
  DC.DEFAULTS = {
    enabled: true,
    learnLang: baseOf(ui) === 'es' ? 'en' : 'es', // the language you're learning
    nativeLang: offeredTag(ui), // the language translations are shown in
    engine: 'builtin', // 'builtin' | 'deepl' | 'none'
    fontScale: 1,
    blur: false,
    autoPause: false,
    pauseOnHover: true,
  };
  DC.LANGS = [
    'ar', 'bg', 'bn', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fr', 'ga', 'gl',
    'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk',
    'sl', 'sr', 'sv', 'sw', 'ta', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh',
  ];
})();
