const DC = globalThis.DC;
const $ = (id) => document.getElementById(id);
const names = DC.namer([navigator.language, 'en']);
const langName = (code) => (code ? names.full(code) : 'Unknown');

let lib = {};
let settings = { ...DC.DEFAULTS };
const view = { filter: 'all', search: '', lang: '', sort: 'new' };

const h = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...children.flat().filter((c) => c != null && c !== false));
  return e;
};

function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('toast').classList.remove('show'), 2000);
}

const fmtTime = (s) => {
  s = Math.floor(s || 0);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// The sentence with the saved word highlighted.
function highlight(sentence, word) {
  const i = sentence.toLocaleLowerCase().indexOf(word.toLocaleLowerCase());
  if (i < 0 || !word) return [sentence];
  return [sentence.slice(0, i), h('mark', {}, sentence.slice(i, i + word.length)), sentence.slice(i + word.length)];
}

// ------------------------------------------------------------ list

const matchesFilter = (e, f) =>
  f === 'all' || (f === 'important' ? e.important : e.status === f);

// view.lang is '' (all), 'base:es' (Spanish, any region) or 'tag:es-PR'.
const matchesLang = (e, l) =>
  !l || (l.startsWith('base:') ? DC.baseOf(e.lang) === l.slice(5) : DC.normTag(e.lang) === l.slice(4));

function visibleEntries() {
  const q = view.search.trim().toLocaleLowerCase();
  const list = Object.values(lib).filter((e) =>
    matchesFilter(e, view.filter) &&
    matchesLang(e, view.lang) &&
    (!q || [e.word, e.translation, e.note, e.sentence, e.sentenceTranslation, e.source?.title, langName(e.lang)]
      .some((s) => s && s.toLocaleLowerCase().includes(q))));
  const sorters = {
    new: (a, b) => b.addedAt - a.addedAt,
    old: (a, b) => a.addedAt - b.addedAt,
    az: (a, b) => a.word.localeCompare(b.word, a.lang || undefined),
    review: (a, b) => (a.reviewedAt || 0) - (b.reviewedAt || 0),
  };
  return list.sort(sorters[view.sort]);
}

function render() {
  const all = Object.values(lib);
  const counts = {
    all: all.length,
    learning: all.filter((e) => e.status === 'learning').length,
    known: all.filter((e) => e.status === 'known').length,
    important: all.filter((e) => e.important).length,
  };
  $('summary').textContent = all.length
    ? `${counts.all} word${counts.all === 1 ? '' : 's'} · ${counts.learning} learning · ${counts.known} learnt · ${counts.important} important`
    : 'Words you save while watching end up here.';
  for (const b of document.querySelectorAll('.tabs button')) {
    b.setAttribute('aria-pressed', String(b.dataset.filter === view.filter));
    b.querySelector('.n').textContent = counts[b.dataset.filter];
  }

  // One option per language, plus its regions when words come from several.
  const tags = [...new Set(all.map((e) => DC.normTag(e.lang)))].sort();
  const lf = $('langFilter');
  const want = tags.join(',');
  if (lf.dataset.sig !== want) {
    lf.dataset.sig = want;
    const byBase = new Map();
    for (const t of tags) byBase.set(DC.baseOf(t), [...(byBase.get(DC.baseOf(t)) || []), t]);
    const opts = [...byBase].sort((a, b) => names.base(a[0]).localeCompare(names.base(b[0]))).map(([b, ts]) =>
      ts.length === 1
        ? new Option(langName(ts[0]), `base:${b}`)
        : h('optgroup', { label: names.base(b) },
            new Option(`All ${names.base(b)}`, `base:${b}`),
            ...ts.map((t) => [t, names.variety(t) || 'No region']).sort((x, y) => x[1].localeCompare(y[1]))
              .map(([t, n]) => new Option(n, `tag:${t}`))));
    lf.replaceChildren(new Option('All languages', ''), ...opts);
    if (![...lf.options].some((o) => o.value === view.lang)) view.lang = '';
    lf.value = view.lang;
  }
  lf.hidden = tags.length < 2;

  const entries = visibleEntries();
  $('list').replaceChildren(...entries.map(card));
  const empty = $('empty');
  empty.hidden = entries.length > 0;
  if (!entries.length) {
    empty.replaceChildren(...(all.length
      ? [h('strong', {}, 'Nothing here'), 'No words match this filter.']
      : [h('strong', {}, 'Your library is empty'),
         'While watching, click any word in the captions and choose “Add to library”. You can also add words here with “+ Add word”.']));
  }
}

function card(e) {
  const update = (patch) => DC.library.put({ key: e.key, ...patch });
  const editable = (cls, value, placeholder, field) => {
    const el = h('textarea', { class: `edit ${cls}`, rows: 1, placeholder, 'aria-label': placeholder });
    el.value = value || '';
    const fit = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; }; // + borders
    el.addEventListener('input', fit);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); } });
    el.addEventListener('change', () => update({ [field]: el.value.trim() }));
    requestAnimationFrame(fit);
    return el;
  };

  const src = e.source?.url
    ? h('a', { href: e.source.url, target: '_blank', rel: 'noopener', title: 'Watch this moment again' },
        `▶ ${e.source.title || e.source.site}${e.source.time != null ? ` · ${fmtTime(e.source.time)}` : ''}`)
    : null;

  return h('article', { class: `card${e.important ? ' important' : ''}` },
    h('div', { class: 'main' },
      h('div', { class: 'word-row' },
        h('h3', { class: 'word', lang: e.lang }, e.word),
        langChip(e),
        e.status === 'known' && h('span', { class: 'badge-known' }, '✓ Learnt'),
        h('button', { class: 'speak', title: 'Pronounce', 'aria-label': 'Pronounce', onclick: () => speak(e.word, e.lang) }, '🔊')),
      editable('tr', e.translation, 'Add a meaning…', 'translation'),
      e.sentence && h('blockquote', { class: 'ctx' },
        h('p', { lang: e.lang }, highlight(e.sentence, e.word)),
        e.sentenceTranslation && h('p', { class: 'ctx-tr' }, e.sentenceTranslation)),
      editable('note', e.note, 'Add a note…', 'note'),
      h('div', { class: 'meta' }, src, h('span', {}, `Added ${fmtDate(e.addedAt)}`),
        e.reviewedAt ? h('span', {}, `Reviewed ${fmtDate(e.reviewedAt)}`) : null)),
    h('div', { class: 'side' },
      h('button', {
        class: 'star', 'aria-pressed': String(!!e.important), title: 'Important words are reviewed first',
        onclick: () => update({ important: !e.important }),
      }, e.important ? '★ Important' : '☆ Important'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Status' },
        ...[['learning', 'Learning'], ['known', 'Learnt']].map(([s, label]) =>
          h('button', { dataset: { status: s }, 'aria-pressed': String(e.status === s), onclick: () => update({ status: s }) }, label))),
      h('button', {
        class: 'del',
        onclick: async () => {
          await DC.library.remove(e.key);
          toast(`Deleted “${e.word}”`);
        },
      }, 'Delete')));
}

// "Spanish · Puerto Rico ▾": the region a word is from, changeable.
function langChip(e) {
  const base = DC.baseOf(e.lang);
  const tag = DC.normTag(e.lang);
  const opts = names.varieties(base);
  if (!opts.length) return h('span', { class: 'lang' }, langName(e.lang));
  if (DC.parseTag(tag).sub && !opts.some(([t]) => t === tag)) opts.push([tag, names.variety(tag)]);
  const sel = h('select', { class: 'lang', 'aria-label': 'Region', title: 'Which region this word is from' },
    new Option(`${names.base(base)} · no region`, base),
    ...opts.map(([t, n]) => new Option(`${names.base(base)} · ${n}`, t)));
  sel.value = DC.parseTag(tag).sub ? tag : base;
  sel.addEventListener('change', async () => {
    try {
      await DC.library.move(e.key, sel.value);
      sel.blur();
    } catch (err) {
      toast(err.message);
      sel.value = DC.parseTag(tag).sub ? tag : base;
    }
  });
  return sel;
}

// Words without a region are spoken in the variety you're learning.
function speak(text, lang) {
  const tag = DC.parseTag(lang).sub || DC.baseOf(lang) !== DC.baseOf(settings.learnLang) ? lang : settings.learnLang;
  const u = new SpeechSynthesisUtterance(text);
  const voice = DC.pickVoice(tag);
  u.lang = voice?.lang || tag;
  if (voice) u.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// Re-rendering while you type in a field would lose your cursor, so wait.
let pending = false;
function rerenderSoon() {
  if (document.activeElement?.closest?.('#list')) { pending = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => {
  if (pending && !document.activeElement?.closest?.('#list')) { pending = false; render(); }
}));

// ------------------------------------------------------------ controls

for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => { view.filter = b.dataset.filter; render(); });
}
$('search').addEventListener('input', (e) => { view.search = e.target.value; render(); });
$('langFilter').addEventListener('change', (e) => { view.lang = e.target.value; render(); });
$('sort').addEventListener('change', (e) => { view.sort = e.target.value; render(); });

// The add form's language and region selects, set to `tag`.
function setAddLang(tag) {
  const f = $('addForm').elements;
  if (!f.lang.options.length) {
    const opts = DC.LANGS.map((c) => [c, names.base(c)]).sort((a, b) => a[1].localeCompare(b[1]));
    f.lang.replaceChildren(...opts.map(([c, n]) => new Option(n, c)));
  }
  const base = DC.LANGS.includes(DC.baseOf(tag)) ? DC.baseOf(tag) : 'es';
  f.lang.value = base;
  const opts = names.varieties(base);
  f.variety.hidden = !opts.length;
  f.variety.replaceChildren(new Option('Any region', base), ...opts.map(([t, n]) => new Option(n, t)));
  f.variety.value = opts.some(([t]) => t === DC.normTag(tag)) ? DC.normTag(tag) : base;
}
$('addForm').elements.lang.addEventListener('change', (ev) => setAddLang(ev.target.value));

$('addBtn').addEventListener('click', () => {
  const f = $('addForm');
  f.hidden = !f.hidden;
  if (!f.hidden) {
    setAddLang(settings.learnLang);
    f.elements.word.focus();
  }
});
$('addForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target.elements;
  const word = f.word.value.trim();
  if (!word) return;
  const lang = f.variety.hidden ? f.lang.value : f.variety.value;
  const existing = lib[DC.library.keyOf(word, lang)];
  await DC.library.put({
    word, lang, translation: f.translation.value.trim(), note: f.note.value.trim(), important: f.important.checked,
    ...(existing ? {} : { status: 'learning', source: { site: 'Added by hand', title: '' } }),
  });
  toast(existing ? `Updated “${word}”` : `Added “${word}”`);
  ev.target.reset();
  setAddLang(lang);
  f.word.focus();
});

// ------------------------------------------------------------ export / import

function download(name, type, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  $('exportCsv').closest('details').open = false;
}
const stamp = () => new Date().toISOString().slice(0, 10);

$('exportCsv').addEventListener('click', () => {
  const cols = ['word', 'translation', 'language', 'variety', 'status', 'important', 'note', 'sentence', 'sentence_translation', 'source', 'link', 'added'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = visibleEntries().map((e) => [
    e.word, e.translation, e.lang, names.variety(e.lang), e.status === 'known' ? 'learnt' : 'learning', e.important ? 'yes' : '', e.note,
    e.sentence, e.sentenceTranslation, e.source?.title || e.source?.site || '', e.source?.url || '', new Date(e.addedAt).toISOString(),
  ].map(q).join(','));
  download(`dual-captions-library-${stamp()}.csv`, 'text/csv;charset=utf-8', '﻿' + [cols.join(','), ...rows].join('\r\n'));
  toast(`Exported ${rows.length} word${rows.length === 1 ? '' : 's'}`);
});

$('exportJson').addEventListener('click', () => {
  download(`dual-captions-library-${stamp()}.json`, 'application/json',
    JSON.stringify({ app: 'dual-captions', version: 1, library: lib }, null, 2));
  toast('Backup saved');
});

$('importJson').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  $('exportCsv').closest('details').open = false;
  if (!file) return;
  let incoming;
  try {
    const data = JSON.parse(await file.text());
    incoming = Object.values(data.library || data).filter((e) => e && typeof e.word === 'string' && e.word.trim());
  } catch {
    toast("That file isn't a Dual Captions backup");
    return;
  }
  const merged = { ...lib };
  let added = 0, updated = 0;
  for (const e of incoming) {
    const key = DC.library.keyOf(e.word, e.lang);
    const cur = merged[key];
    if (!cur) added++;
    else if ((e.updatedAt || 0) > (cur.updatedAt || 0)) updated++;
    else continue;
    merged[key] = { status: 'learning', important: false, addedAt: Date.now(), ...e, key, updatedAt: e.updatedAt || Date.now() };
  }
  await DC.library.replaceAll(merged);
  toast(`Restored: ${added} new, ${updated} updated`);
});

// ------------------------------------------------------------ review

const rv = { deck: [], i: 0, shown: false, learnt: 0 };

$('reviewBtn').addEventListener('click', () => {
  // Review what's on screen; on "All", that means the words still being learnt.
  let deck = visibleEntries();
  if (view.filter === 'all') deck = deck.filter((e) => e.status === 'learning');
  deck.sort((a, b) => (b.important - a.important) || (a.reviewedAt || 0) - (b.reviewedAt || 0));
  if (!deck.length) { toast('Nothing to review here yet'); return; }
  Object.assign(rv, { deck: deck.slice(0, 30), i: 0, shown: false, learnt: 0 });
  $('review').hidden = false;
  showCard();
});

function closeReview() { $('review').hidden = true; }
$('reviewClose').addEventListener('click', closeReview);
$('review').addEventListener('click', (e) => { if (e.target === $('review')) closeReview(); });

function showCard() {
  const body = $('reviewBody');
  if (rv.i >= rv.deck.length) {
    $('reviewProgress').textContent = '';
    body.replaceChildren(h('div', { class: 'fc-done' },
      h('strong', {}, 'Done!'),
      `${rv.deck.length} reviewed · ${rv.learnt} marked learnt`,
      h('div', { class: 'fc-actions' }, h('button', { class: 'btn primary', onclick: closeReview }, 'Back to library'))));
    return;
  }
  const e = rv.deck[rv.i];
  $('reviewProgress').textContent = `${rv.i + 1} / ${rv.deck.length}${e.important ? ' · ★ important' : ''}`;
  const parts = [
    h('div', { class: 'fc-word', lang: e.lang }, e.word),
    h('div', { class: 'fc-lang' }, langName(e.lang), ' ',
      h('button', { class: 'speak', title: 'Pronounce', onclick: () => speak(e.word, e.lang) }, '🔊')),
    e.sentence && h('p', { class: 'fc-ctx', lang: e.lang }, highlight(e.sentence, e.word)),
  ];
  if (!rv.shown) {
    parts.push(h('div', { class: 'fc-actions' }, h('button', { class: 'btn primary', onclick: reveal }, 'Show meaning')),
      h('p', { class: 'fc-hint' }, 'Space to show · Esc to stop'));
  } else {
    parts.push(
      h('div', { class: 'fc-answer' },
        h('div', { class: 'fc-tr' }, e.translation || '(no meaning saved yet)'),
        e.sentenceTranslation && h('div', { class: 'fc-sub' }, e.sentenceTranslation),
        e.note && h('div', { class: 'fc-sub' }, `Note: ${e.note}`)),
      h('div', { class: 'fc-actions' },
        h('button', { class: 'btn', onclick: () => grade(false) }, 'Still learning'),
        h('button', { class: 'btn good', onclick: () => grade(true) }, 'Got it: mark learnt')),
      h('p', { class: 'fc-hint' }, '1 still learning · 2 got it'));
  }
  body.replaceChildren(...parts.filter(Boolean));
}

function reveal() { rv.shown = true; showCard(); }

async function grade(learnt) {
  const e = rv.deck[rv.i];
  if (learnt) rv.learnt++;
  await DC.library.put({ key: e.key, reviewedAt: Date.now(), ...(learnt ? { status: 'known' } : {}) });
  rv.i++;
  rv.shown = false;
  showCard();
}

document.addEventListener('keydown', (e) => {
  if ($('review').hidden) return;
  if (e.key === 'Escape') closeReview();
  else if (rv.i >= rv.deck.length) return;
  else if (!rv.shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
  else if (rv.shown && e.key === '1') grade(false);
  else if (rv.shown && e.key === '2') grade(true);
});

// ------------------------------------------------------------ start

DC.library.onChange((next) => { lib = next; rerenderSoon(); });
(async () => {
  const stored = await chrome.storage.local.get(['settings', 'library']);
  settings = { ...DC.DEFAULTS, ...stored.settings };
  lib = stored.library || {};
  const f = new URLSearchParams(location.search).get('filter');
  if (f && ['all', 'learning', 'known', 'important'].includes(f)) view.filter = f;
  render();
})();
