import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractMetadata, htmlToText } from '../_ctx/generic-context.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (condition, message) => {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
};

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const load = (name) => parseHTML(readFileSync(path.join(here, 'fixtures', name), 'utf8')).document;
const bookUrl = 'https://www.zhswx.com/book/67504.html';
const tocUrl = 'https://www.zhswx.com/chapter/67504.html';
const chapterUrl = 'https://www.zhswx.com/read/67504_26617005.html';

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match a book page');
A(pattern.test('https://tw.zhswx.com/book/67504.html'), 'url_pattern must match a traditional-script book page');
A(!pattern.test(chapterUrl), 'url_pattern must reject chapter pages');
A(!pattern.test(tocUrl), 'url_pattern must reject the ToC page (metadata lives on the book page)');

const book = load('book.html');
// toc_url must lead off the book page: its 最新章节 block also matches toc.item, so a
// miss would silently crawl only the newest chapters.
const tocHref = book.querySelector(rule.selectors.toc.toc_url)?.getAttribute('href');
A(tocHref && new URL(tocHref, bookUrl).toString() === tocUrl, `toc_url resolved to "${tocHref}"`);

const meta = extractMetadata(book, rule.selectors);
A(meta.title === '1984：从破产川菜馆开始', `title selector failed, got: "${meta.title}"`);
A(meta.author === '轻语江湖', `author selector failed, got: "${meta.author}"`);
A(meta.cover === '/images/zhsid/67504.jpg', `cover selector failed, got: "${meta.cover}"`);
A(meta.genres === '都市', `genres selector failed, got: "${meta.genres}"`);
const desc = htmlToText(meta.description);
A(desc.startsWith('【年代文、美食、日常、种田】'), `description start wrong: "${desc.slice(0, 30)}"`);
A(desc.endsWith('《川渝暴龙也是传承？》'), `description end wrong: "${desc.slice(-30)}"`);
A(!/内容简介|阅读目录|开始阅读|分\s*类/.test(desc), 'page labels leaked into the description');

// 699 entries = 694 numbered chapters (the site lacks 第269/309/680章) + 5 author notices.
const toc = Array.from(load('toc.html').querySelectorAll(rule.selectors.toc.item)).map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), tocUrl).toString(),
}));
A(toc.length === 699, `expected 699 ToC links, got ${toc.length}`);
A(toc[0].title === '第1章 重生1984' && toc[0].url === chapterUrl, `first chapter wrong: ${JSON.stringify(toc[0])}`);
A(toc.at(-1).title === '第697章 耶！黄尚驾到啊！（1.4w加更求月票！）', `last chapter title wrong: "${toc.at(-1).title}"`);
A(toc.at(-1).url === 'https://www.zhswx.com/read/67504_27093820.html', `last chapter url wrong: "${toc.at(-1).url}"`);
A(new Set(toc.map((ch) => ch.url)).size === toc.length, 'duplicate chapter URLs found');
A(toc.every((ch) => /\/read\/67504_\d+\.html$/.test(ch.url)), 'a non-chapter link leaked into the ToC');

const chapter = load('chapter.html');
const matches = chapter.querySelectorAll(rule.selectors.chapter.content);
A(matches.length === 1, `chapter content selector must match exactly one element, got ${matches.length}`);
const content = matches[0].cloneNode(true);
for (const selector of rule.selectors.chapter.remove) {
  content.querySelectorAll(selector).forEach((node) => node.remove());
}
const text = (content.textContent || '').replace(/\s+/g, ' ').trim();
A(text.startsWith('“听说周砚那小子早上救的姑娘'), `chapter text start was dropped, starts: "${text.slice(0, 20)}"`);
A(text.endsWith('三天后要交店租，先把房租赚到再说。'), `chapter tail was dropped, ends: "${text.slice(-20)}"`);
for (const junk of ['上一章', '下一章', '目录', '推荐小说', '更新时间', '宙斯', 'zhswx']) {
  A(!text.includes(junk), `page junk "${junk}" leaked into chapter content`);
}
A(!content.querySelector('script, style, a, div'), 'script/link/nested div leaked into chapter content');

console.log('OK: zhswx.com generic rule — metadata, toc_url, 699-entry ToC, and clean chapter content');
