// Every t('…') string in src/ must have an English entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../src/i18n.en.ts';

function* files(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (p.endsWith('.ts') && !p.endsWith('i18n.en.ts')) yield p;
  }
}

test('every translatable string has an English version', () => {
  const missing: string[] = [];
  for (const f of files('src')) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/gs)) {
      const key = m[2]!.replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (!(key in EN)) missing.push(`${f}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('placeholders survive translation', () => {
  for (const [es, en] of Object.entries(EN)) {
    const a = [...es.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const b = [...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(b, a, es);
  }
});
