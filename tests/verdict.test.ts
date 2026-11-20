import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexPhrase, verdictHtml } from '../src/verdict.ts';

const base = { enough: true, median: 30, median_lo: 29, median_hi: 31, median_hint: null, s: { '15': 0.95, '20': 0.88 }, index: 70, index_lo: 65, index_hi: 75, deaths: 1000, exposure: 50000, export_rate: 0.1, observed_to: 39 };

test('index phrase: below, above and not distinguishable from the average', () => {
  assert.match(indexPhrase('es', base), /un 30 % menos/);
  assert.match(indexPhrase('es', { ...base, index: 130, index_lo: 120, index_hi: 140 }), /un 30 % más/);
  assert.match(indexPhrase('en', { ...base, index: 102, index_lo: 95, index_hi: 109 }), /same rate/);
});

test('no figure is invented when data are scarce', () => {
  const v = verdictHtml('es', 'Coche X', { ...base, enough: false }, 28);
  assert.match(v, /pocas bajas/);
  assert.doesNotMatch(v, /\d+,\d años/);
});

test('large indices read as a multiple', () => {
  assert.match(indexPhrase('es', { ...base, index: 362, index_lo: 330, index_hi: 400 }), /3,6 veces más/);
});
