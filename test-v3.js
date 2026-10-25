// V3 scoring, ticker parsing and run-to-run change. Run: node test-v3.js
const assert = require('assert');
const { scoreRows, parseTickers, changeText } = require('./score');

const row = (Status, Severity, Section) => ({ Status, Severity, Section, Check: 'x', Evidence: '' });
let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok  ' + name); };

t('score weights High 3, Medium 2, Low 1 over tested checks only', () => {
  const r = scoreRows([row('FLAG', 'High', 'A'), row('OK', 'Medium', 'A'), row('OK', 'Low', 'B'), row('Not tested', 'High', 'B')]);
  assert.strictEqual(r.score, 50); // 3 / (3 + 2 + 1)
  assert.strictEqual(r.flags, 1);
  assert.strictEqual(r.highFlags, 1);
  assert.strictEqual(r.coverage, 75);
});

t('all OK scores 0 and band Low', () => {
  const r = scoreRows([row('OK', 'High', 'A'), row('OK', 'Low', 'A')]);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.band, 'Low');
});

t('no tested checks gives null score and band Unrated', () => {
  const r = scoreRows([row('Not tested', 'High', 'A')]);
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.band, 'Unrated');
});

t('band edges (calibrated on 29 companies): 9.9 Low, 10 Moderate, 17.5 High, 30 Very high', () => {
  const mk = (flagged, ok) => scoreRows([].concat(Array(flagged).fill(row('FLAG', 'Low', 'A')), Array(ok).fill(row('OK', 'Low', 'A'))));
  assert.strictEqual(mk(99, 901).band, 'Low');
  assert.strictEqual(mk(10, 90).band, 'Moderate');
  assert.strictEqual(mk(174, 826).band, 'Moderate');
  assert.strictEqual(mk(175, 825).band, 'High');
  assert.strictEqual(mk(30, 70).band, 'Very high');
});

t('section scores are computed per section', () => {
  const r = scoreRows([row('FLAG', 'Low', 'A'), row('OK', 'Low', 'A'), row('OK', 'Low', 'B')]);
  assert.strictEqual(r.sections.A, 50);
  assert.strictEqual(r.sections.B, 0);
});

t('parseTickers splits on commas, spaces, newlines; uppercases; dedupes; strips junk', () => {
  const r = parseTickers('ioc, Reliance\nioc  tcs;; m&m <script>');
  assert.deepStrictEqual(r.tickers, ['IOC', 'RELIANCE', 'TCS', 'M&M', 'SCRIPT']);
});

t('parseTickers caps at the limit and reports dropped ones', () => {
  const r = parseTickers('A B C D E', 3);
  assert.deepStrictEqual(r.tickers, ['A', 'B', 'C']);
  assert.deepStrictEqual(r.dropped, ['D', 'E']);
});

t('parseTickers on empty input returns nothing', () => {
  assert.deepStrictEqual(parseTickers('  ,, ').tickers, []);
});

t('changeText: first run, up, down, same', () => {
  assert.strictEqual(changeText(undefined, 30), 'New');
  assert.strictEqual(changeText(20, 30), 'Worse (+10.0)');
  assert.strictEqual(changeText(30, 22.5), 'Better (-7.5)');
  assert.strictEqual(changeText(30, 30.04), 'No change');
  assert.strictEqual(changeText(30, null), '');
});

console.log('\n' + n + ' tests passed');
