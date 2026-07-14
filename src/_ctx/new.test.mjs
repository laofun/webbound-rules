// new.mjs must scaffold valid scriptable + generic folders that build clean.
import { scaffold } from '../../scripts/new.mjs';
import { generate } from '../../scripts/build.mjs';
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const root = mkdtempSync(path.join(tmpdir(), 'wbnew-'));

const dir = scaffold(root, 'demo.example', { generic: false });
A(dir === path.join(root, 'src/demo.example'), 'scaffold returned wrong dir');
A(existsSync(path.join(root, 'src/demo.example/rule.json')), 'rule.json missing');
A(existsSync(path.join(root, 'src/demo.example/parser.js')), 'parser.js missing for scriptable');
A(existsSync(path.join(root, 'src/demo.example/fixtures')), 'fixtures/ missing');
const rule = JSON.parse(readFileSync(path.join(root, 'src/demo.example/rule.json'), 'utf8'));
A(rule.domain === 'demo.example', 'scaffolded domain != folder name');
A(rule.parser_type === 'scriptable', 'scaffolded parser_type should be scriptable');

scaffold(root, 'gen.example', { generic: true });
A(!existsSync(path.join(root, 'src/gen.example/parser.js')), 'generic must not scaffold parser.js');

let threw = false;
try { scaffold(root, 'demo.example', {}); } catch { threw = true; }
A(threw, 'scaffold must refuse an existing folder');

writeFileSync(path.join(root, 'src/repo.meta.json'), JSON.stringify({ name: 'x', version: '1' }));
const { ruleFiles } = generate(path.join(root, 'src'));
A(JSON.parse(ruleFiles.get('demo.example')).script.startsWith('({'), 'scaffolded scriptable did not inline a script');
A(JSON.parse(ruleFiles.get('gen.example')).script === undefined, 'scaffolded generic must have no script');

console.log('OK: new.mjs — scaffolds scriptable + generic folders that build clean');
