// Node mirror of the extension's generic-rule metadata extraction, so rule tests
// see what the crawler sees. Source of truth (port changes by hand; no drift check):
//   ../NovelPacker-Extension/src/core/utils/index.ts
//     splitTransforms, applyTransforms, Utils.extractText / extractTextAll / extractHtml
//   ../NovelPacker-Extension/src/features/crawler/parser/generic/GenericParser.ts
//     fetchMetadata: info.remove, implied `@src` on cover, genres joined with ", "
//
// Semantics that bite: a text selector reads EVERY match and concatenates them
// (cheerio `.text()`), so `tr:nth-of-type(2) td` on a page with three tables leaks
// the other two tables into the field. `@attr` and `desc` (innerHTML) read only the
// first match; `genres` yields one entry per match. A transform whose argument is
// not found leaves the string unchanged.
import { parseHTML } from 'linkedom';

export function splitTransforms(selector) {
  const pipe = selector.indexOf('|');
  if (pipe < 0) return { head: selector, transforms: [] };
  return { head: selector.slice(0, pipe), transforms: selector.slice(pipe + 1).split('|') };
}

export function applyTransforms(text, transforms) {
  let result = text;
  for (const raw of transforms) {
    const t = raw.trim();
    if (!t) continue;
    const colon = t.indexOf(':');
    const op = colon < 0 ? t : t.slice(0, colon);
    const arg = colon < 0 ? '' : t.slice(colon + 1);
    if (op === 'after') { const i = result.indexOf(arg); if (i >= 0) result = result.slice(i + arg.length); }
    else if (op === 'before') { const i = result.indexOf(arg); if (i >= 0) result = result.slice(0, i); }
    else if (op === 'regex') { try { const m = result.match(new RegExp(arg)); if (m) result = m[1] !== undefined ? m[1] : m[0]; } catch { /* bad regex: engine warns and skips */ } }
    else if (op === 'replace') { const s = arg.indexOf('/'); const search = s < 0 ? arg : arg.slice(0, s); const repl = s < 0 ? '' : arg.slice(s + 1); if (search) result = result.split(search).join(repl); }
    else if (op === 'trim') result = result.trim();
  }
  return result.trim();
}

const splitAttr = (head) => (head.includes('@') ? head.split('@') : [head, '']);

export function extractText(root, selector) {
  if (!selector) return '';
  const { head, transforms } = splitTransforms(selector);
  const [sel, attr] = splitAttr(head);
  const els = Array.from(root.querySelectorAll(sel));
  const raw = attr ? els[0]?.getAttribute(attr) || '' : els.map((el) => el.textContent).join('').trim();
  return applyTransforms(raw, transforms);
}

export function extractTextAll(root, selector) {
  if (!selector) return [];
  const { head, transforms } = splitTransforms(selector);
  const [sel, attr] = splitAttr(head);
  return Array.from(root.querySelectorAll(sel))
    .map((el) => applyTransforms((attr ? el.getAttribute(attr) || '' : el.textContent).trim(), transforms))
    .filter(Boolean);
}

export function extractHtml(root, selector) {
  if (!selector) return '';
  const { head, transforms } = splitTransforms(selector);
  const [sel] = splitAttr(head);
  return applyTransforms(root.querySelector(sel)?.innerHTML.trim() || '', transforms);
}

// GenericParser.fetchMetadata minus its "Unknown Title" fallbacks and cover
// absolutizing. `description` is HTML (see htmlToText). Mutates `root` when the
// rule has `info.remove`, exactly like the engine strips the page first.
export function extractMetadata(root, selectors) {
  for (const sel of selectors.info?.remove ?? []) root.querySelectorAll(sel).forEach((el) => el.remove());
  const coverSel = selectors.cover || '';
  const coverHead = coverSel.split('|')[0];
  const coverEffective = coverHead.includes('@') ? coverSel : `${coverHead}@src${coverSel.slice(coverHead.length)}`;
  return {
    title: extractText(root, selectors.title),
    author: extractText(root, selectors.author),
    cover: coverSel ? extractText(root, coverEffective) : '',
    description: extractHtml(root, selectors.desc),
    status: extractText(root, selectors.status || ''),
    genres: selectors.genres ? extractTextAll(root, selectors.genres).join(', ') || undefined : undefined,
  };
}

export const htmlToText = (html) =>
  parseHTML(`<div>${html}</div>`).document.querySelector('div').textContent.replace(/\s+/g, ' ').trim();
