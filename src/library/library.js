const DC = globalThis.DC;
const $ = (id) => document.getElementById(id);
const names = new Intl.DisplayNames([navigator.language, 'en'], { type: 'language' });
const langName = (code) => { try { return code ? names.of(code) : 'Unknown'; } catch { return code; } };

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

function visibleEntries() {
  const q = view.search.trim().toLocaleLowerCase();
  const list = Object.values(lib).filter((e) =>
    matchesFilter(e, view.filter) &&
    (!view.lang || e.lang === view.lang) &&
    (!q || [e.word, e.translation, e.note, e.sentence, e.sentenceTranslation, e.source?.title]
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

  const langs = [...new Set(all.map((e) => e.lang))].sort();
  const lf = $('langFilter');
  const want = ['', ...langs].join(',');
  if (lf.dataset.sig !== want) {
    lf.dataset.sig = want;
    lf.replaceChildren(new Option('All languages', ''), ...langs.map((l) => new Option(langName(l), l)));
    if (!langs.includes(view.lang)) view.lang = '';
    lf.value = view.lang;
  }
  lf.hidden = langs.length < 2;

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
        h('span', { class: 'lang' }, langName(e.lang)),
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

function speak(text, lang) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
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

$('addBtn').addEventListener('click', () => {
  const f = $('addForm');
  f.hidden = !f.hidden;
  if (!f.hidden) {
    const sel = f.elements.lang;
    if (!sel.options.length) {
      const opts = DC.LANGS.map((c) => [c, langName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
      sel.replaceChildren(...opts.map(([c, n]) => new Option(n, c)));
    }
    sel.value = DC.LANGS.includes(settings.learnLang) ? settings.learnLang : 'es';
    f.elements.word.focus();
  }
});
$('addForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target.elements;
  const word = f.word.value.trim();
  if (!word) return;
  const lang = f.lang.value;
  const existing = lib[DC.library.keyOf(word, lang)];
  await DC.library.put({
    word, lang, translation: f.translation.value.trim(), note: f.note.value.trim(), important: f.important.checked,
    ...(existing ? {} : { status: 'learning', source: { site: 'Added by hand', title: '' } }),
  });
  toast(existing ? `Updated “${word}”` : `Added “${word}”`);
  ev.target.reset();
  f.lang.value = lang;
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
  const cols = ['word', 'translation', 'language', 'status', 'important', 'note', 'sentence', 'sentence_translation', 'source', 'link', 'added'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = visibleEntries().map((e) => [
    e.word, e.translation, e.lang, e.status === 'known' ? 'learnt' : 'learning', e.important ? 'yes' : '', e.note,
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
