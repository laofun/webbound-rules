// Pins the engine semantics generic rule tests rely on: all-match concatenation
// for text, first match for @attr / desc, one genre per match, and the pipe ops.
import { parseHTML } from 'linkedom';
import { extractText, extractTextAll, extractHtml, extractMetadata, applyTransforms, htmlToText } from './generic-context.mjs';

const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const { document: doc } = parseHTML(`
  <table><tr><td>类别：玄幻</td><td>作者：Alice</td></tr></table>
  <table><tr><td>845、反诗</td><td>844、知县</td></tr></table>
  <div class="tags"><a>Thriller</a><a>Mystery</a></div>
  <div class="intro"><span>简介：</span><br/>Once <b>upon</b></div>
  <img class="cover" src="/a.jpg"><img class="cover" src="/b.jpg">`);

A(extractText(doc, 'tr td:nth-of-type(2)') === '作者：Alice844、知县', 'text must concatenate every match like cheerio .text()');
A(extractText(doc, 'tr td:nth-of-type(2)|after:者：|trim') === 'Alice844、知县', 'transforms run on the concatenated text');
A(extractText(doc, 'img.cover@src') === '/a.jpg', '@attr reads the first match only');
A(extractTextAll(doc, '.tags a').join(', ') === 'Thriller, Mystery', 'genres: one entry per match');
A(extractHtml(doc, '.intro|regex:简介：(?:</span>)?([\\s\\S]+)') === '<br>Once <b>upon</b>', 'desc: first match innerHTML + regex group');
A(htmlToText('<br>Once <b>upon</b>') === 'Once upon', 'htmlToText');

A(applyTransforms('a-b-c', ['before:-']) === 'a', 'before');
A(applyTransforms('a-b-c', ['replace:-/+']) === 'a+b+c', 'replace');
A(applyTransforms('x', ['after:missing']) === 'x', 'a non-matching transform leaves the string unchanged');
A(applyTransforms('  x  ', ['bogus']) === 'x', 'unknown op skipped, result trimmed');

const meta = extractMetadata(doc, { title: 'td', author: 'tr td:nth-of-type(2)|after:者：', cover: 'img.cover', desc: '.intro', genres: '.tags a' });
A(meta.cover === '/a.jpg', 'cover gets an implied @src');
A(meta.genres === 'Thriller, Mystery', 'genres joined with ", "');
A(meta.status === '', 'missing status selector → empty');

console.log('OK: generic-context — all-match text, first-match attr/html, per-match genres, pipe ops');
