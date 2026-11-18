// grab.mjs helpers: --idx ranges and chapter HTML → one paragraph per line.
import { parseIdx, htmlToText } from '../../scripts/grab.mjs';

const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

A(parseIdx('3,1-2,2,9', 5).join() === '1,2,3', 'ranges, dedupe, sort, clamp to the ToC');
A(htmlToText('<p>甲 &amp; 乙</p><p> </p>丙<br/>丁<br>') === '甲 & 乙\n丙\n丁', 'p/br split, entities, blanks dropped');

console.log('OK: grab parses --idx and chapter text');
