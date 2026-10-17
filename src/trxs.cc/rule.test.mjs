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
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');
const bookUrl = 'https://www.trxs.cc/tongren/12455.html';
const chapterUrl = 'https://www.trxs.cc/tongren/12455/1.html';

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match a book page');
A(!pattern.test(chapterUrl), 'url_pattern must reject chapter pages');
A(!pattern.test(new URL('/author/1/x.html', bookUrl).toString()), 'url_pattern must reject author pages');

const { document: book } = parseHTML(bookHtml);
const text = (selector) => (book.querySelector(selector)?.textContent || '').trim();
A(text(rule.selectors.title) === '东京：从收留离家JK开始(1-171)', `title selector failed, got: "${text(rule.selectors.title)}"`);
A(text(rule.selectors.author) === '南猫一只天', `author selector failed, got: "${text(rule.selectors.author)}"`);
A(book.querySelector(rule.selectors.cover)?.getAttribute('src')?.endsWith('4fa43e00d1044ccca0102acd7ddaf594.jpeg'), 'cover selector failed');
A(text(rule.selectors.desc).includes('上杉朔继承了一家老旅馆'), 'description selector failed');

const tocLinks = Array.from(book.querySelectorAll(rule.selectors.toc.item));
A(tocLinks.length === 140, `expected 140 ToC links, got ${tocLinks.length}`);
const toc = tocLinks.map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), bookUrl).toString(),
}));
A(toc[0].title === '第1节', 'first chapter title is wrong');
A(toc[0].url === chapterUrl, 'first chapter url is wrong');
A(toc[toc.length - 1].title === '第140节', 'last chapter title is wrong');
A(toc[toc.length - 1].url === new URL('140.html', chapterUrl).toString(), 'last chapter url is wrong');
A(new Set(toc.map((ch) => ch.url)).size === toc.length, 'duplicate chapter URLs found');

const { document: chapter } = parseHTML(chapterHtml);
const content = chapter.querySelector(rule.selectors.chapter.content)?.cloneNode(true);
A(content, 'chapter content selector failed');
for (const selector of rule.selectors.chapter.remove) {
  content.querySelectorAll(selector).forEach((node) => node.remove());
}
const cleanText = (content.textContent || '').replace(/\s+/g, ' ').trim();
A(cleanText.includes('雨宫澪抿了抿嘴'), 'chapter text was dropped');
A(cleanText.includes('我会努力工作的'), 'chapter tail was dropped');
A(!content.innerHTML.includes('<script'), 'script leaked into chapter content');
A(!cleanText.includes('下一章'), 'page navigation leaked into chapter content');

console.log('OK: trxs.cc generic rule — metadata, ToC, and clean chapter content');
