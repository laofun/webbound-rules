// pickCharset mirrors the extension's fetchHtml: header → meta → utf-8, gb2312 → gbk.
import { pickCharset, decode } from '../../scripts/fetch-fixture.mjs';

const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const buf = (s) => new TextEncoder().encode(s).buffer;

A(pickCharset('text/html; charset=GBK', buf('')) === 'gbk', 'header charset wins');
A(pickCharset('text/html; charset=utf-8', buf('<meta charset="big5">')) === 'big5', 'utf-8 header defers to meta');
A(pickCharset(null, buf('<meta http-equiv="Content-Type" content="text/html; charset=gb2312">')) === 'gbk', 'http-equiv + gb2312 upgrade');
A(pickCharset('text/html', buf('<html>')) === 'utf-8', 'default utf-8');

// 中 in GBK is 0xD6 0xD0.
A(decode(new Uint8Array([0xd6, 0xd0]).buffer, 'gbk') === '中', 'gbk decode');
A(decode(buf('ok'), 'no-such-charset') === 'ok', 'unknown label falls back to utf-8');

console.log('OK: fetch-fixture picks charsets like the extension');
