// The word library, kept in chrome.storage.local under "library" as
// { [key]: entry }. Shared by the content script, popup and library page.
//
// entry = {
//   key, word, lang,                 key is `${lang}|${word lowercased}`; lang
//                                    includes the variety when known ('es-PR'),
//                                    so a word can be saved once per variety
//   translation, note,
//   status: 'learning' | 'known',
//   important: boolean,
//   sentence, sentenceTranslation,   the caption line it was saved from
//   source: { site, title, url },    url jumps back to that moment
//   addedAt, updatedAt, reviewedAt
// }
(() => {
  const DC = (globalThis.DC ??= {});
  const STORE = 'library';

  const keyOf = (word, lang) => `${(lang || '').toLowerCase()}|${word.trim().toLocaleLowerCase(lang || undefined)}`;

  async function all() {
    const { [STORE]: lib = {} } = await chrome.storage.local.get(STORE);
    return lib;
  }

  // Add a word or merge fields into an existing one; returns the entry.
  async function put(fields) {
    const lib = await all();
    const key = fields.key || keyOf(fields.word, fields.lang);
    const now = Date.now();
    const prev = lib[key];
    const entry = prev
      ? { ...prev, ...fields, key, updatedAt: now }
      : {
          word: '', lang: '', translation: '', note: '', status: 'learning', important: false,
          sentence: '', sentenceTranslation: '', source: null, reviewedAt: 0,
          ...fields, key, addedAt: now, updatedAt: now,
        };
    // Keep the first context a word was saved with unless a new one is given.
    if (prev && !fields.sentence) entry.sentence = prev.sentence;
    lib[key] = entry;
    await chrome.storage.local.set({ [STORE]: lib });
    return entry;
  }

  async function remove(key) {
    const lib = await all();
    delete lib[key];
    await chrome.storage.local.set({ [STORE]: lib });
  }

  // Give an entry another language tag (usually to set its variety). Fails
  // with code 'exists' if the word is already saved under that tag.
  async function move(key, lang) {
    const lib = await all();
    const entry = lib[key];
    if (!entry) return null;
    const to = keyOf(entry.word, lang);
    if (to !== key && lib[to]) throw Object.assign(new Error(`“${entry.word}” is already saved for that variety`), { code: 'exists' });
    delete lib[key];
    lib[to] = { ...entry, lang, key: to, updatedAt: Date.now() };
    await chrome.storage.local.set({ [STORE]: lib });
    return lib[to];
  }

  async function replaceAll(lib) {
    await chrome.storage.local.set({ [STORE]: lib });
  }

  function onChange(fn) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORE]) fn(changes[STORE].newValue || {});
    });
  }

  DC.library = { keyOf, all, put, remove, move, replaceAll, onChange };
})();
