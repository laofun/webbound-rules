#!/usr/bin/env node
// Helper script to fetch a page, detect & decode character encoding (GBK / Big5 / UTF-8),
// and save it as a clean UTF-8 fixture file for offline tests.
// Usage: node .agents/skills/webbound-rule-authoring/scripts/fetch-fixture.mjs <url> <output-filepath> [encoding]

import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2];
const outFile = process.argv[3];
let overrideEncoding = process.argv[4];

if (!url || !outFile) {
  console.log('Usage: node fetch-fixture.mjs <url> <output-filepath> [gbk|big5|utf-8]');
  process.exit(1);
}

console.log(`Fetching ${url} ...`);
const res = await fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});

if (!res.ok) {
  console.error(`HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}

const buffer = await res.arrayBuffer();

// Detect encoding from Content-Type header or meta tag if not overridden
let encoding = overrideEncoding?.toLowerCase();
if (!encoding) {
  const contentType = res.headers.get('content-type') || '';
  if (/gbk|gb2312|gb18030/i.test(contentType)) {
    encoding = 'gbk';
  } else if (/big5/i.test(contentType)) {
    encoding = 'big5';
  } else {
    // Inspect first 1000 bytes for <meta ... charset="...">
    const preview = new TextDecoder('ascii').decode(buffer.slice(0, 1000));
    if (/charset=["']?(gbk|gb2312|gb18030)/i.test(preview)) {
      encoding = 'gbk';
    } else if (/charset=["']?big5/i.test(preview)) {
      encoding = 'big5';
    } else {
      encoding = 'utf-8';
    }
  }
}

console.log(`Decoding using charset: ${encoding}`);
let html = '';
try {
  const decoder = new TextDecoder(encoding);
  html = decoder.decode(buffer);
} catch (err) {
  console.warn(`TextDecoder('${encoding}') failed (${err.message}) — falling back to utf-8`);
  html = new TextDecoder('utf-8').decode(buffer);
}

const targetDir = path.dirname(outFile);
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.writeFileSync(outFile, html, 'utf8');
console.log(`Saved fixture (${html.length} chars) to ${outFile}`);
