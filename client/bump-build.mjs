import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const file = join(dir, '.build-number');

let current = 0;
try {
  current = parseInt(readFileSync(file, 'utf8').trim(), 10) || 0;
} catch (e) {}

const next = current + 1;
writeFileSync(file, String(next));
writeFileSync(join(dir, 'build-number.json'), JSON.stringify({ number: next }, null, 2));
console.log(`Build #${next}`);