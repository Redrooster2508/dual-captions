// Run with: node tests/parsers.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ctx = vm.createContext({ console, Intl, TextDecoder });
ctx.globalThis = ctx;
for (const f of ['src/content/parsers.js', 'src/content/translate.js']) {
  vm.runInContext(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
}
const { parse, cues, baseLang } = ctx.DC;
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

test('engine language codes', () => {
  assert.equal(baseLang('es-419'), 'es');
  assert.equal(baseLang('zh-Hans'), 'zh');
  assert.equal(baseLang('zh-TW'), 'zh-Hant');
  assert.equal(baseLang('pt_BR'), 'pt');
});

console.log(`\n${n} passed (TTML is tested in the browser, it needs DOMParser)`);
