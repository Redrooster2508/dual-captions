// Run with: node tests/parsers.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const chrome = { i18n: { getUILanguage: () => 'en-GB' } };
const ctx = vm.createContext({ console, Intl, TextDecoder, chrome });
ctx.globalThis = ctx;
for (const f of ['src/shared/settings.js', 'src/content/parsers.js', 'src/content/translate.js']) {
  vm.runInContext(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
}
const DC = ctx.DC;
const { parse, cues } = DC;
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('WebVTT with settings, tags and entities', () => {
  const c = parse.vtt(`WEBVTT

NOTE a comment

1
00:00:01.000 --> 00:00:03.500 position:50% align:center
<c.bg_transparent>&lrm;¿Qué tal?</c>
<i>Muy bien</i> &amp; tú

00:01:02.5 --> 00:01:04.000
Hola`);
  assert.equal(c.length, 2);
  assert.deepEqual([c[0].start, c[0].end], [1, 3.5]);
  assert.equal(c[0].text, '‎¿Qué tal?\nMuy bien & tú');
  assert.deepEqual([c[1].start, c[1].end], [62.5, 64]);
});

test('SRT with CRLF, commas and ASS-style tags', () => {
  const c = parse.srt('1\r\n00:00:01,200 --> 00:00:02,000\r\n{\\an8}<b>Top</b>\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,250\r\nSecond\r\nline\r\n');
  assert.equal(c.length, 2);
  assert.equal(c[0].text, 'Top');
  assert.equal(c[0].start, 1.2);
  assert.equal(c[1].text, 'Second\nline');
  assert.equal(c[1].end, 6.25);
});

test('ASS: dialogue, override tags, drawings skipped, duplicates merged', () => {
  const c = parse.ass(`[Script Info]
Title: x

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Hello,{\\i0} world\\Nline two
Dialogue: 1,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Hello,{\\i0} world\\Nline two
Dialogue: 0,0:00:03.00,0:00:04.00,Sign,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}`);
  assert.equal(c.length, 1);
  assert.equal(c[0].text, 'Hello, world\nline two');
  assert.deepEqual([c[0].start, c[0].end], [1, 2.5]);
});

test('YouTube json3, roll-up captions trimmed', () => {
  const c = parse.json3(JSON.stringify({ events: [
    { tStartMs: 0, dDurationMs: 5000, id: 1, wpWinPosId: 1 },
    { tStartMs: 100, dDurationMs: 4000, wWinId: 1, segs: [{ utf8: 'hola' }, { utf8: ' amigos', tOffsetMs: 300 }] },
    { tStartMs: 2000, dDurationMs: 10, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 2010, dDurationMs: 4000, wWinId: 1, segs: [{ utf8: 'qué tal' }] },
  ] }));
  assert.equal(c.length, 2);
  assert.equal(c[0].text, 'hola amigos');
  assert.equal(c[0].end, 2.01);
  assert.equal(c[1].text, 'qué tal');
});

test('auto-detects format from name and content', () => {
  assert.equal(parse.auto('WEBVTT\n\n00:00.000 --> 00:01.000\nA').length, 1);
  assert.equal(parse.auto('1\n00:00:00,000 --> 00:00:01,000\nB', 'x.srt')[0].text, 'B');
  assert.equal(parse.auto('[Script Info]\n[Events]\nFormat: Start, End, Text\nDialogue: 0:00:00.00,0:00:01.00,C')[0].text, 'C');
});

test('language from file name', () => {
  assert.equal(parse.langFromFilename('Movie.2019.es.srt'), 'es');
  assert.equal(parse.langFromFilename('show_S01E01.pt-BR.vtt'), 'pt-BR');
  assert.equal(parse.langFromFilename('movie.srt'), '');
  assert.equal(parse.langFromFilename('movie.zz.srt'), '');
});

test('active cue lookup with overlaps and gaps', () => {
  const list = [{ start: 0, end: 2, text: 'a' }, { start: 1, end: 3, text: 'b' }, { start: 5, end: 6, text: 'c' }];
  assert.deepEqual(Array.from(cues.active(list, 1.5), (x) => x.text), ['a', 'b']);
  assert.deepEqual(Array.from(cues.active(list, 4), (x) => x.text), []);
  assert.equal(cues.lastStartedIndex(list, 4), 1);
  assert.equal(cues.lastStartedIndex(list, -1), -1);
});

// Pick the best of several language tags for `want`, as the extension does.
const best = (tags, want) => tags.filter((t) => DC.langFit(t, want) > 0)
  .sort((a, b) => DC.langFit(b, want) - DC.langFit(a, want))[0] ?? null;

test('language tags: aliases, regions, scripts', () => {
  assert.deepEqual({ ...DC.parseTag('pt_br') }, { base: 'pt', sub: 'BR' });
  assert.equal(DC.normTag('es-419'), 'es-419');
  assert.equal(DC.normTag('zh-hant-tw'), 'zh-TW');
  assert.equal(DC.normTag('zh-HANS'), 'zh-Hans');
  assert.equal(DC.normTag('iw'), 'he'); // YouTube still says iw for Hebrew
  assert.equal(DC.normTag('fil'), 'tl');
  assert.equal(DC.langFit('iw', 'he'), 100);
  assert.equal(DC.langFit('fr', 'es'), 0);
});

test('Spanish: Spain, Mexico and Puerto Rico each get the closest subtitles', () => {
  const tracks = ['es', 'es-ES', 'es-419', 'es-MX', 'es-DO'];
  assert.equal(best(tracks, 'es-ES'), 'es-ES');
  assert.equal(best(tracks, 'es-MX'), 'es-MX');
  assert.equal(best(tracks, 'es-PR'), 'es-DO'); // Caribbean neighbour first
  assert.equal(best(['es', 'es-ES', 'es-419'], 'es-PR'), 'es-419');
  assert.equal(best(['es', 'es-ES'], 'es-PR'), 'es'); // plain beats another region
  assert.equal(best(['es-ES', 'es-419'], 'es'), 'es-ES'); // no region wanted: any will do
  assert.equal(best(['es-GT', 'es-ES'], 'es-MX'), 'es-GT'); // regions not offered still group
});

test('other languages with regional varieties', () => {
  assert.equal(best(['pt-BR', 'pt-PT'], 'pt-AO'), 'pt-PT');
  assert.equal(best(['en-US', 'en-GB'], 'en-AU'), 'en-GB');
  assert.equal(best(['en-US', 'en-GB'], 'en-CA'), 'en-US');
  assert.equal(best(['fr', 'fr-CA'], 'fr-BE'), 'fr');
  assert.equal(best(['fr-FR', 'fr-CA'], 'fr-CA'), 'fr-CA');
  assert.equal(best(['zh-Hans', 'zh-Hant'], 'zh-HK'), 'zh-Hant');
  assert.equal(best(['zh-CN', 'zh-TW'], 'zh-Hant'), 'zh-TW');
  assert.equal(best(['zh', 'zh-Hant'], 'zh-Hans'), 'zh');
  assert.equal(best(['ar-SA', 'ar-LB'], 'ar-SY'), 'ar-LB');
});

test('Catalan: Valencian has its own variant subtag', () => {
  assert.equal(DC.normTag('ca-ES-valencia'), 'ca-valencia');
  assert.equal(DC.normTag('ca-es-VALENCIA'), 'ca-valencia');
  assert.equal(DC.normTag('ca-ES'), 'ca-ES');
  assert.equal(DC.normTag('en-GB-oxendict'), 'en-GB'); // variants not listed are ignored
  assert.equal(best(['ca', 'ca-ES-valencia', 'ca-AD'], 'ca-valencia'), 'ca-ES-valencia');
  assert.equal(best(['ca', 'ca-ES-valencia'], 'ca-ES'), 'ca-ES-valencia'); // same group beats plain
  assert.equal(best(['ca-AD', 'ca-FR'], 'ca-valencia'), 'ca-AD');
  const n = DC.namer(['en']);
  assert.equal(n.full('ca-ES-valencia'), 'Catalan (Valencia)');
  assert.equal(n.variety('ca-ES'), 'Catalonia');
  assert.equal(n.variety('es-ES'), 'Spain'); // the Catalan label stays with Catalan
  assert.deepEqual(Array.from(n.varieties('ca'), ([t]) => t), ['ca-AD', 'ca-ES', 'ca-valencia']);
  assert.equal(DC.offeredTag('ca-FR'), 'ca-ES');
});

test('Persian: Iran and Afghanistan (Dari)', () => {
  assert.equal(DC.normTag('prs'), 'fa-AF'); // Dari's own code
  assert.equal(DC.normTag('pes'), 'fa-IR');
  assert.equal(DC.normTag('fa'), 'fa');
  assert.equal(best(['fa', 'fa-AF'], 'fa-IR'), 'fa');
  assert.equal(best(['fa', 'prs'], 'fa-AF'), 'prs');
  assert.deepEqual(Array.from(DC.namer(['en']).varieties('fa'), ([t, name]) => `${t}=${name}`), ['fa-AF=Afghanistan', 'fa-IR=Iran']);
});

test('languages added in 0.2.1', () => {
  const n = DC.namer(['en']);
  assert.deepEqual(['ca', 'gl', 'eu', 'ga', 'cy'].map((c) => DC.LANGS.includes(c) && n.base(c)).join(), 'Catalan,Galician,Basque,Irish,Welsh');
});

test('defaults, popup options and names', () => {
  assert.equal(DC.DEFAULTS.nativeLang, 'en-GB');
  assert.equal(DC.offeredTag('zh-CN'), 'zh-Hans');
  assert.equal(DC.offeredTag('es-GT'), 'es-419');
  assert.equal(DC.offeredTag('en-SG'), 'en-GB');
  assert.equal(DC.offeredTag('ja-JP'), 'ja');
  const n = DC.namer(['en']);
  assert.equal(n.full('es-PR'), 'Spanish (Puerto Rico)');
  assert.equal(n.full('zh-Hant'), 'Chinese (Traditional)');
  assert.equal(n.variety('es-419'), 'Latin America');
  assert.ok(n.varieties('es').some(([t, name]) => t === 'es-PR' && name === 'Puerto Rico'));
  assert.equal(n.varieties('ja').length, 0);
});

test('translation engines get the closest variety they have', () => {
  const deepl = (t) => DC.deeplTarget(t);
  assert.deepEqual(['en', 'en-US', 'en-CA', 'en-GB', 'en-AU', 'en-IE'].map(deepl), ['EN-US', 'EN-US', 'EN-US', 'EN-GB', 'EN-GB', 'EN-GB']);
  assert.deepEqual(['pt', 'pt-BR', 'pt-PT', 'pt-MZ'].map(deepl), ['PT-BR', 'PT-BR', 'PT-PT', 'PT-PT']);
  assert.deepEqual(['es', 'es-ES', 'es-MX', 'es-PR', 'es-419'].map(deepl), ['ES', 'ES', 'ES-419', 'ES-419', 'ES-419']);
  assert.deepEqual(['zh', 'zh-Hans', 'zh-TW', 'zh-HK'].map(deepl), ['ZH-HANS', 'ZH-HANS', 'ZH-HANT', 'ZH-HANT']);
  assert.deepEqual(['fr-CA', 'de-AT'].map(deepl), ['FR', 'DE']);
  const builtin = (t) => DC.translate.outputLang(t, 'builtin');
  assert.deepEqual(['es-PR', 'pt-PT', 'zh-TW', 'zh-CN'].map(builtin), ['es', 'pt', 'zh-Hant', 'zh']);
});

console.log(`\n${n} passed (TTML is tested in the browser, it needs DOMParser)`);
