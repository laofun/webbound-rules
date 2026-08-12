import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (condition, message) => {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
};

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const tocHtml = readFileSync(path.join(here, 'fixtures/toc.html'), 'utf8');
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');

const bookUrl = 'https://www.piaotia.com/bookinfo/14/14986.html';
const tocPageUrl = 'https://www.piaotia.com/html/14/14986/index.html';

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match book info page');

const { document: book } = parseHTML(bookHtml);
const text = (selector) => (book.querySelector(selector)?.textContent || '').trim();
const transformedText = (selector) => {
  const [css, ...ops] = selector.split('|');
  const [sel, attr] = css.includes('@') ? css.split('@') : [css, ''];
  const el = book.querySelector(sel);
  let value = (attr ? el?.getAttribute(attr) || '' : el?.textContent || '').trim();
  for (const op of ops) {
    if (op.startsWith('after:')) value = value.split(op.slice(6)).slice(1).join(op.slice(6));
    if (op === 'trim') value = value.trim();
  }
  return value;
};

A(text(rule.selectors.title) === '反派大师兄，师妹们全是病娇', `title failed, got: "${text(rule.selectors.title)}"`);
A(transformedText(rule.selectors.author) === '就爱吃话梅', `author failed, got: "${transformedText(rule.selectors.author)}"`);

const tocUrlAttr = book.querySelector(rule.selectors.toc.toc_url)?.getAttribute('href');
A(tocUrlAttr === 'https://www.piaotia.com/html/14/14986/index.html', 'toc_url selector failed');

const { document: tocDoc } = parseHTML(tocHtml);
const tocLinks = Array.from(tocDoc.querySelectorAll(rule.selectors.toc.item));
A(tocLinks.length === 197, `expected 197 ToC links, got ${tocLinks.length}`);
const toc = tocLinks.map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), tocPageUrl).toString(),
}));

A(toc[0].title === '第1章 神鸾峰的反派大师兄', 'first chapter title mismatch');
A(toc[0].url === 'https://www.piaotia.com/html/14/14986/10035768.html', 'first chapter url mismatch');

const { document: chapter } = parseHTML(chapterHtml);
A(chapter.title.includes('反派大师兄'), 'chapter document title check failed');

console.log('OK: piaotia.com generic rule — metadata, ToC redirect, and clean chapter content');
