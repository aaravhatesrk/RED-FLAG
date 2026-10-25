// V3: weighted risk score, ticker list parsing and run-to-run change. Pure functions, no dependencies.
const WEIGHT = { High: 3, Medium: 2, Low: 1 };
// Band cut-offs (share of tested weight that is flagged), fitted 2026-10-25 on 29 companies labelled
// good/moderate/bad in advance. Provisional: 19 of 29 matched vs 11 of 29 for the earlier 15/30/50.
const BANDS = [[10, 'Low'], [17.5, 'Moderate'], [30, 'High']];
const MAX_TICKERS = 10;

const round1 = (x) => Math.round(x * 10) / 10;

function pctFlagged(rows) {
  const tested = rows.filter((r) => r.Status === 'FLAG' || r.Status === 'OK');
  const total = tested.reduce((s, r) => s + (WEIGHT[r.Severity] || 1), 0);
  if (!total) return null;
  const flagged = tested.filter((r) => r.Status === 'FLAG').reduce((s, r) => s + (WEIGHT[r.Severity] || 1), 0);
  return round1((flagged / total) * 100);
}

function bandFor(score) {
  if (score === null) return 'Unrated';
  const hit = BANDS.find(([limit]) => score < limit);
  return hit ? hit[1] : 'Very high';
}

// rows: check rows with Status, Severity, Section (no SUMMARY row).
function scoreRows(rows) {
  const score = pctFlagged(rows);
  const sections = {};
  rows.forEach((r) => { if (!(r.Section in sections)) sections[r.Section] = pctFlagged(rows.filter((x) => x.Section === r.Section)); });
  const flagged = rows.filter((r) => r.Status === 'FLAG');
  const tested = rows.filter((r) => r.Status !== 'Not tested').length;
  return {
    score,
    band: bandFor(score),
    flags: flagged.length,
    highFlags: flagged.filter((r) => r.Severity === 'High').length,
    coverage: rows.length ? Math.round((tested / rows.length) * 100) : 0,
    sections,
  };
}

function parseTickers(text, max) {
  const limit = max || MAX_TICKERS;
  const seen = new Set();
  String(text || '').toUpperCase().split(/[\s,;]+/).forEach((tok) => {
    const t = tok.replace(/[^A-Z0-9&-]/g, '');
    if (t) seen.add(t);
  });
  const all = Array.from(seen);
  return { tickers: all.slice(0, limit), dropped: all.slice(limit) };
}

function changeText(previous, current) {
  if (current === null || current === undefined) return '';
  if (previous === undefined || previous === null) return 'New';
  const d = round1(current - previous);
  if (Math.abs(d) < 0.5) return 'No change';
  return d > 0 ? 'Worse (+' + d.toFixed(1) + ')' : 'Better (' + d.toFixed(1) + ')';
}

if (typeof module !== 'undefined') module.exports = { scoreRows, parseTickers, changeText, MAX_TICKERS };
