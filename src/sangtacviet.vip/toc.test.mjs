// ToC anchor: built script + real vendored ctx must yield 95 absolute chapter URLs.
import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const rule = JSON.parse(readFileSync(path.join(root, 'rules/sangtacviet.vip.json'), 'utf8'));
const parser = new Function('return ' + rule.script)();
const listRaw = readFileSync(path.join(here, 'fixtures/getchapterlist.txt'), 'utf8');

let fetchedUrl = '';
const ctx = createScriptableContext({
  html: '',
  url: 'https://sangtacviet.vip/truyen/qidian/1/1049545651/',
  config: rule.config,
  fetch: async (u) => { fetchedUrl = u; return listRaw; },
});

const chapters = await parser.extractToC(ctx);

A(/sajax=getchapterlist/.test(fetchedUrl), 'ToC fetch URL missing sajax=getchapterlist — ' + fetchedUrl);
A(chapters.length === 95, `expected 95 chapters, got ${chapters.length}`);
const re = /^https:\/\/sangtacviet\.vip\/truyen\/qidian\/1\/1049545651\/\d+\/$/;
A(chapters.every(c => re.test(c.url)), 'some chapter URLs are not absolute in canonical form');
A(chapters[0].url === 'https://sangtacviet.vip/truyen/qidian/1/1049545651/909671868/', 'first chapter URL wrong — ' + chapters[0].url);
A(chapters.every(c => !/vip/i.test(c.title)), 'a chapter title still contains "vip"');
A(new Set(chapters.map(c => c.url)).size === chapters.length, 'duplicate chapter URLs found');

console.log('OK: sangtacviet toc — 95 chapters, absolute URLs, first 909671868, no dup');
