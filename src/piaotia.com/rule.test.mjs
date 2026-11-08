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

const bookUrl = 'https://www.piaotia.com/bookinfo/15/15702.html';
const tocPageUrl = 'https://www.piaotia.com/html/15/15702/index.html';
const chapterUrl = 'https://www.piaotia.com/html/15/15702/11425412.html';

// Mirrors the extension's generic engine (core/utils/index.ts). Text selectors
// concatenate EVERY match (cheerio `.text()`), so a selector that also hits the
// chapter-preview or review tables leaks their text into the field. `genres`
// yields one value per match; `desc` reads the first match's innerHTML.
const split = (selector) => {
  const bar = selector.indexOf('|');
  const head = bar < 0 ? selector : selector.slice(0, bar);
  const ops = bar < 0 ? [] : selector.slice(bar + 1).split('|');
  const [sel, attr] = head.includes('@') ? head.split('@') : [head, ''];
  return { sel, attr, ops };
};
const transform = (value, ops) => {
  let r = value;
  for (const op of ops) {
    const colon = op.indexOf(':');
    const name = colon < 0 ? op : op.slice(0, colon);
    const arg = colon < 0 ? '' : op.slice(colon + 1);
    if (name === 'after') { const i = r.indexOf(arg); if (i >= 0) r = r.slice(i + arg.length); }
    else if (name === 'before') { const i = r.indexOf(arg); if (i >= 0) r = r.slice(0, i); }
    else if (name === 'regex') { const m = r.match(new RegExp(arg)); if (m) r = m[1] ?? m[0]; }
    else if (name === 'trim') r = r.trim();
  }
  return r.trim();
};
const extractText = (doc, selector) => {
  const { sel, attr, ops } = split(selector);
  const els = [...doc.querySelectorAll(sel)];
  const raw = attr ? els[0]?.getAttribute(attr) || '' : els.map((e) => e.textContent).join('');
  return transform(raw.trim(), ops);
};
const extractTextAll = (doc, selector) => {
  const { sel, attr, ops } = split(selector);
  return [...doc.querySelectorAll(sel)]
    .map((e) => transform((attr ? e.getAttribute(attr) || '' : e.textContent).trim(), ops))
    .filter(Boolean);
};
const extractHtml = (doc, selector) => {
  const { sel, ops } = split(selector);
  return transform(doc.querySelector(sel)?.innerHTML.trim() || '', ops);
};
const textOf = (html) => parseHTML(`<div>${html}</div>`).document.querySelector('div').textContent.replace(/\s+/g, ' ').trim();

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match book info page');
A(!pattern.test(chapterUrl), 'url_pattern must not match a chapter page');

// --- book page: the fixture has a "本站推荐" sidebar with five other covers
// before the book's own, plus chapter-preview and review tables whose cells
// share the info table's row/column positions.
const { document: book } = parseHTML(bookHtml);
const title = extractText(book, rule.selectors.title);
const author = extractText(book, rule.selectors.author);
const status = extractText(book, rule.selectors.status);
const genres = extractTextAll(book, rule.selectors.genres);
const cover = extractText(book, rule.selectors.cover);
const desc = textOf(extractHtml(book, rule.selectors.desc));

A(title === '青山', `title failed, got: "${title}"`);
A(author === '会说话的肘子', `author failed, got: "${author}"`);
A(status === '连载中', `status failed, got: "${status}"`);
A(genres.join(', ') === '玄幻魔法', `genres failed, got: "${genres.join(', ')}"`);
A(cover === 'https://www.piaotia.com/files/article/image/15/15702/15702s.jpg', `cover failed, got: "${cover}"`);
A(desc.startsWith('洛城夜幕下的骏马与少年郎'), `desc failed, got: "${desc.slice(0, 60)}"`);
A(!desc.includes('最新章节') && !desc.includes('内容简介'), `desc has labels: "${desc.slice(0, 60)}"`);
// The label sits inside a <span>; cutting after it must not leave a dangling
// </span> — the EPUB intro page embeds this HTML in XHTML.
A(!extractHtml(book, rule.selectors.desc).includes('</span>'), 'desc HTML has a dangling </span>');

const tocUrlAttr = book.querySelector(rule.selectors.toc.toc_url)?.getAttribute('href');
A(tocUrlAttr === tocPageUrl, `toc_url selector failed, got: "${tocUrlAttr}"`);

// --- ToC: 848 numbered chapters + 第一卷总结 + three titles the site lists
// twice under distinct URLs = 852 links. That is what the site shows.
const { document: tocDoc } = parseHTML(tocHtml);
const toc = Array.from(tocDoc.querySelectorAll(rule.selectors.toc.item)).map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), tocPageUrl).toString(),
}));
A(toc.length === 852, `expected 852 ToC links, got ${toc.length}`);
A(toc[0].title === '第1章 归零', `first chapter title mismatch: "${toc[0].title}"`);
A(toc[0].url === chapterUrl, `first chapter url mismatch: "${toc[0].url}"`);
A(toc.at(-1).title === '848、阉党细作', `last chapter title mismatch: "${toc.at(-1).title}"`);
A(toc.at(-1).url === 'https://www.piaotia.com/html/15/15702/13141891.html', `last chapter url mismatch: "${toc.at(-1).url}"`);

// --- chapter: piaotia chapter pages have no <body>/<\/head> tags. Browsers and
// cheerio synthesize a body (so `content: "body"` works in the extension);
// linkedom parks everything under <head>, so emulate with the root element
// minus head-only tags. Do not "fix" the rule's `content` for this.
const { document: chapter } = parseHTML(chapterHtml);
A(!/<body[\s>]/i.test(chapterHtml), 'fixture now has a <body>; drop the linkedom workaround below');
const content = chapter.documentElement;
for (const sel of ['title', 'meta', 'link', ...rule.selectors.chapter.remove]) {
  content.querySelectorAll(sel).forEach((el) => el.remove());
}
const chapterText = content.textContent.replace(/\s+/g, ' ').trim();
A(chapterText.includes('洛城，秋。'), 'chapter text start missing');
A(chapterText.includes('犹如黑色火焰般在地面不停摇曳、跳动'), 'chapter text end missing');
for (const junk of ['上一章', '返回目录', '返回顶部', '加入书架', '举报']) {
  A(!chapterText.includes(junk), `chapter text still has nav junk "${junk}"`);
}
A(!content.querySelector('script, style, table'), 'chapter still has script/style/table');

console.log('OK: piaotia.com generic rule — metadata, ToC redirect, and clean chapter content');
