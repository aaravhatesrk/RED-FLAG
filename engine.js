// Red-flag screener V2 engine. Pure JS, no dependencies, so the same body runs in an n8n Code node.
// Input: screener.in company page HTML. Output: { company, years, rows[] } with one row per check.

const SECTIONS = ['profit-loss', 'balance-sheet', 'cash-flow', 'ratios', 'quarters', 'shareholding'];

function cleanText(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/\s*\+\s*$/, '').trim();
}

function toNumber(s) {
  const t = cleanText(s).replace(/,/g, '').replace(/%/g, '');
  if (t === '' || t === '-') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

// Returns { years: [...], rows: { label: [values aligned to years] } } for the first table of a section.
function parseSection(html, id) {
  const sec = html.match(new RegExp('<section id="' + id + '"[\\s\\S]*?</section>'));
  if (!sec) return null;
  const table = sec[0].match(/<table[\s\S]*?<\/table>/);
  if (!table) return null;
  const head = table[0].match(/<thead[\s\S]*?<\/thead>/);
  const years = head ? [...head[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => cleanText(m[1])).slice(1) : [];
  const rows = {};
  for (const tr of table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 2) continue;
    rows[cleanText(cells[0])] = cells.slice(1).map(toNumber);
  }
  return { years, rows };
}

// Top ratios list: { 'Stock P/E': [5.51], 'High / Low': [189, 125], ... }
function parseTopRatios(html) {
  const ul = html.match(/<ul id="top-ratios"[\s\S]*?<\/ul>/);
  const out = {};
  if (!ul) return out;
  for (const li of ul[0].matchAll(/<li[\s\S]*?<\/li>/g)) {
    const name = (li[0].match(/<span class="name">([\s\S]*?)<\/span>/) || [])[1];
    if (name) out[cleanText(name)] = [...li[0].matchAll(/<span class="number">([\s\S]*?)<\/span>/g)].map((m) => toNumber(m[1]));
  }
  return out;
}

// Extra sources arrive as raw text from separate HTTP calls (screener chart + peers APIs, NSE pledge API).
// Anything missing or malformed stays null so the dependent checks report "Not tested".
function parseExtras(extras) {
  const x = extras || {};
  const json = (t) => { try { return typeof t === 'string' ? JSON.parse(t) : null; } catch (e) { return null; } };
  const dataset = (j, metric) => (j && Array.isArray(j.datasets) ? j.datasets.find((d) => d.metric === metric && Array.isArray(d.values) && d.values.length) : null);
  const out = { medianPe: null, priceChange: null, peerPe: [], pledge: null, pledgeDate: null };

  const med = dataset(json(x.pe), 'Median PE');
  if (med) out.medianPe = Number(med.values[med.values.length - 1][1]);

  const px = dataset(json(x.price), 'Price');
  if (px && px.values.length > 1) {
    const first = Number(px.values[0][1]), last = Number(px.values[px.values.length - 1][1]);
    if (first > 0 && Number.isFinite(last)) out.priceChange = last / first - 1;
  }

  const peers = typeof x.peers === 'string' ? x.peers : '';
  const heads = [...(peers.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*<th[\s\S]*?<\/tr>/) || [''])[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => cleanText(m[1]));
  const col = heads.indexOf('P/E');
  if (col >= 0) {
    for (const tr of peers.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cleanText(m[1]));
      const v = /^\d+\.$/.test(cells[0] || '') ? toNumber(cells[col] || '') : null;
      if (v !== null && v > 0) out.peerPe.push(v);
    }
  }

  const pl = json(x.pledge);
  const row = pl && Array.isArray(pl.data) ? pl.data[0] : null;
  if (row) { out.pledge = toNumber(String(row.percPromoterShares)); out.pledgeDate = row.shp; }
  return out;
}

function parseCompany(html) {
  const out = { company: (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1], data: {}, ratios: parseTopRatios(html) };
  out.company = out.company ? cleanText(out.company) : 'Unknown';
  for (const id of SECTIONS) out.data[id] = parseSection(html, id);
  return out;
}

const ANNUAL = /^[A-Z][a-z]{2} \d{4}$/;
const LABELS = {
  sales: ['profit-loss', 'Sales'], opProfit: ['profit-loss', 'Operating Profit'], opm: ['profit-loss', 'OPM %'],
  expenses: ['profit-loss', 'Expenses'], otherInc: ['profit-loss', 'Other Income'], interest: ['profit-loss', 'Interest'],
  dep: ['profit-loss', 'Depreciation'], pbt: ['profit-loss', 'Profit before tax'], tax: ['profit-loss', 'Tax %'],
  np: ['profit-loss', 'Net Profit'], eps: ['profit-loss', 'EPS in Rs'], payout: ['profit-loss', 'Dividend Payout %'],
  eqCap: ['balance-sheet', 'Equity Capital'], reserves: ['balance-sheet', 'Reserves'], borrow: ['balance-sheet', 'Borrowings'],
  otherLiab: ['balance-sheet', 'Other Liabilities'], fixedAssets: ['balance-sheet', 'Fixed Assets'], cwip: ['balance-sheet', 'CWIP'],
  investments: ['balance-sheet', 'Investments'], otherAssets: ['balance-sheet', 'Other Assets'], totalAssets: ['balance-sheet', 'Total Assets'],
  cfo: ['cash-flow', 'Cash from Operating Activity'], cfi: ['cash-flow', 'Cash from Investing Activity'],
  cff: ['cash-flow', 'Cash from Financing Activity'], fcf: ['cash-flow', 'Free Cash Flow'],
  debtorDays: ['ratios', 'Debtor Days'], invDays: ['ratios', 'Inventory Days'], payDays: ['ratios', 'Days Payable'],
  wcDays: ['ratios', 'Working Capital Days'], roce: ['ratios', 'ROCE %'],
};

const QLABELS = {
  sales: ['quarters', 'Sales'], opm: ['quarters', 'OPM %'], otherInc: ['quarters', 'Other Income'],
  pbt: ['quarters', 'Profit before tax'], np: ['quarters', 'Net Profit'],
};
const SHLABELS = {
  promoters: ['shareholding', 'Promoters'], fii: ['shareholding', 'FIIs'], dii: ['shareholding', 'DIIs'], pub: ['shareholding', 'Public'],
};

// Label matching tolerates trailing text, e.g. "EPS in Rs" vs "EPS in Rs".
function findRow(section, label) {
  if (!section) return null;
  const key = Object.keys(section.rows).find((k) => k === label || k.startsWith(label));
  return key ? { years: section.years, values: section.rows[key] } : null;
}

// Aligns every labelled series on the given period labels.
function alignOn(parsed, years, labels) {
  const s = {};
  for (const [name, [sec, label]] of Object.entries(labels)) {
    const row = findRow(parsed.data[sec], label);
    s[name] = years.map((y) => {
      if (!row) return null;
      const i = row.years.indexOf(y);
      return i < 0 ? null : row.values[i];
    });
  }
  return s;
}

// Annual series align on the profit-loss year labels; quarterly and shareholding series on their own period labels.
function buildSeries(parsed) {
  const pl = parsed.data['profit-loss'];
  if (!pl) return null;
  const years = pl.years.filter((y) => ANNUAL.test(y));
  const periods = (id) => (parsed.data[id] ? parsed.data[id].years.filter((y) => ANNUAL.test(y)) : []);
  return {
    years, s: alignOn(parsed, years, LABELS),
    q: alignOn(parsed, periods('quarters'), QLABELS),
    sh: alignOn(parsed, periods('shareholding'), SHLABELS),
    ratios: parsed.ratios,
  };
}

// ---- helpers over a series (index 0 = latest year) ----
const at = (arr, k) => (arr && arr.length > k ? arr[arr.length - 1 - k] : null);
const has = (...vals) => vals.every((v) => v !== null && v !== undefined && Number.isFinite(v));
const lastN = (arr, n) => arr.slice(-n);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString('en-IN');
const pct = (v) => (Math.round(v * 1000) / 10) + '%';

function cagr(arr, years) {
  const a = at(arr, 0);
  const b = at(arr, years);
  return has(a, b) && a > 0 && b > 0 ? Math.pow(a / b, 1 / years) - 1 : null;
}

function risingRun(arr, runLen) {
  const v = lastN(arr, runLen + 1);
  return v.length === runLen + 1 && v.every(Number.isFinite) && v.every((x, i) => i === 0 || x > v[i - 1]);
}

function fallingRun(arr, runLen) {
  const v = lastN(arr, runLen + 1);
  return v.length === runLen + 1 && v.every(Number.isFinite) && v.every((x, i) => i === 0 || x < v[i - 1]);
}

function ratioSeries(num, den) {
  return num.map((n, i) => (has(n, den[i]) && den[i] !== 0 ? n / den[i] : null));
}

const sumKnown = (arr) => (lastN(arr, arr.length).every(Number.isFinite) ? sum(arr) : null);

// ---- checks: each returns null (cannot test), or { flag, ev } ----
function buildChecks({ s, q, sh, ratios }, x) {
  const equity = s.eqCap.map((e, i) => (has(e, s.reserves[i]) ? e + s.reserves[i] : null));
  const de = ratioSeries(s.borrow, equity);
  const checks = [];
  const add = (id, section, severity, name, fn) => checks.push({ id, section, severity, name, fn });

  // A. Earnings quality
  add('A1', 'Earnings quality', 'High', 'Cash from operations below 0.8x net profit in 3 of last 5 years', () => {
    const cfo = lastN(s.cfo, 5), np = lastN(s.np, 5);
    if (cfo.length < 5 || !cfo.every(Number.isFinite) || !np.every(Number.isFinite)) return null;
    const bad = cfo.filter((c, i) => np[i] > 0 && c / np[i] < 0.8).length;
    return { flag: bad >= 3, ev: bad + ' of 5 years below 0.8x' };
  });
  add('A2', 'Earnings quality', 'High', 'Five-year cumulative cash from operations below cumulative net profit', () => {
    const c = sumKnown(lastN(s.cfo, 5)), n = sumKnown(lastN(s.np, 5));
    if (!has(c, n)) return null;
    return { flag: c < n, ev: 'CFO ' + f1(c) + ' vs net profit ' + f1(n) + ' (Rs Cr)' };
  });
  add('A3', 'Earnings quality', 'High', 'Net profit rising while cash from operations falls for 2 years', () => {
    const np = lastN(s.np, 3), cfo = lastN(s.cfo, 3);
    if (np.length < 3 || !np.every(Number.isFinite) || !cfo.every(Number.isFinite)) return null;
    return { flag: np[1] > np[0] && np[2] > np[1] && cfo[1] < cfo[0] && cfo[2] < cfo[1], ev: 'NP ' + np.map(f1).join(' > ') + '; CFO ' + cfo.map(f1).join(' > ') };
  });
  add('A4', 'Earnings quality', 'Medium', 'Other income above 20% of profit before tax', () => {
    const o = at(s.otherInc, 0), p = at(s.pbt, 0);
    if (!has(o, p) || p <= 0) return null;
    return { flag: o / p > 0.2, ev: 'Other income is ' + pct(o / p) + ' of PBT' };
  });
  add('A5', 'Earnings quality', 'Medium', 'Other income growing 10+ points faster than operating profit (3-year CAGR)', () => {
    const o = cagr(s.otherInc, 3), p = cagr(s.opProfit, 3);
    if (!has(o, p)) return null;
    return { flag: o - p > 0.1, ev: 'Other income ' + pct(o) + ' vs operating profit ' + pct(p) + ' a year' };
  });
  add('A6', 'Earnings quality', 'Medium', 'Tax rate below 15% in each of the last 2 years', () => {
    const t = lastN(s.tax, 2);
    if (t.length < 2 || !t.every(Number.isFinite)) return null;
    return { flag: t.every((x) => x < 15), ev: 'Tax rate ' + t.join('%, ') + '%' };
  });
  add('A7', 'Earnings quality', 'Low', 'Tax rate above 35% in the latest year', () => {
    const t = at(s.tax, 0);
    return has(t) ? { flag: t > 35, ev: 'Tax rate ' + t + '%' } : null;
  });
  add('A8', 'Earnings quality', 'Medium', 'Depreciation as % of fixed assets down 25%+ over 3 years', () => {
    const now = at(s.dep, 0) / at(s.fixedAssets, 0), then = at(s.dep, 3) / at(s.fixedAssets, 3);
    if (!has(now, then) || then <= 0) return null;
    return { flag: now < then * 0.75, ev: 'Depreciation rate ' + pct(then) + ' to ' + pct(now) };
  });
  add('A9', 'Earnings quality', 'Low', 'Operating margin moved more than 5 points in the latest year', () => {
    const a = at(s.opm, 0), b = at(s.opm, 1);
    return has(a, b) ? { flag: Math.abs(a - b) > 5, ev: 'OPM ' + b + '% to ' + a + '%' } : null;
  });
  add('A10', 'Earnings quality', 'Medium', 'EPS growing 5+ points slower than net profit (dilution, 3-year CAGR)', () => {
    const e = cagr(s.eps, 3), n = cagr(s.np, 3);
    if (!has(e, n)) return null;
    return { flag: n - e > 0.05, ev: 'EPS ' + pct(e) + ' vs net profit ' + pct(n) + ' a year' };
  });

  // B. Cash flow and capital allocation
  add('B1', 'Cash flow', 'Medium', 'Free cash flow negative in 3 of last 5 years', () => {
    const f = lastN(s.fcf, 5);
    if (f.length < 5 || !f.every(Number.isFinite)) return null;
    const bad = f.filter((x) => x < 0).length;
    return { flag: bad >= 3, ev: bad + ' of 5 years negative (' + f.map(f1).join(', ') + ')' };
  });
  add('B2', 'Cash flow', 'High', 'Five-year cumulative free cash flow negative while profit is positive', () => {
    const f = sumKnown(lastN(s.fcf, 5)), n = sumKnown(lastN(s.np, 5));
    if (!has(f, n)) return null;
    return { flag: f < 0 && n > 0, ev: 'FCF ' + f1(f) + ' vs net profit ' + f1(n) + ' (Rs Cr)' };
  });
  add('B3', 'Cash flow', 'Medium', 'Financing brings in cash in 4 of last 5 years (needs outside money)', () => {
    const c = lastN(s.cff, 5);
    if (c.length < 5 || !c.every(Number.isFinite)) return null;
    const pos = c.filter((x) => x > 0).length;
    return { flag: pos >= 4, ev: pos + ' of 5 years positive financing cash flow' };
  });
  add('B4', 'Cash flow', 'High', 'Operating cash flow negative while financing cash flow is positive', () => {
    const o = at(s.cfo, 0), f = at(s.cff, 0);
    return has(o, f) ? { flag: o < 0 && f > 0, ev: 'CFO ' + f1(o) + ', CFF ' + f1(f) + ' (Rs Cr)' } : null;
  });
  add('B5', 'Cash flow', 'Medium', 'Capital work in progress above 30% of fixed assets and rising 3 years', () => {
    const share = ratioSeries(s.cwip, s.fixedAssets);
    const now = at(share, 0);
    if (!has(now)) return null;
    return { flag: now > 0.3 && risingRun(s.cwip, 3), ev: 'CWIP is ' + pct(now) + ' of fixed assets' };
  });
  add('B6', 'Cash flow', 'Medium', 'Three-year dividends exceed three-year free cash flow while borrowings rise', () => {
    const div = lastN(s.np, 3).map((n, i) => n * lastN(s.payout, 3)[i] / 100);
    const f = sumKnown(lastN(s.fcf, 3)), d = sumKnown(div);
    const b0 = at(s.borrow, 0), b3 = at(s.borrow, 3);
    if (!has(f, d, b0, b3)) return null;
    return { flag: d > f && b0 > b3, ev: 'Dividends ' + f1(d) + ' vs FCF ' + f1(f) + '; borrowings ' + f1(b3) + ' to ' + f1(b0) };
  });
  add('B7', 'Cash flow', 'Low', 'Investments growing 15%+ a year while ROCE falls', () => {
    const g = cagr(s.investments, 3);
    if (!has(g)) return null;
    return { flag: g > 0.15 && at(s.roce, 0) < at(s.roce, 3), ev: 'Investments ' + pct(g) + ' a year; ROCE ' + at(s.roce, 3) + '% to ' + at(s.roce, 0) + '%' };
  });

  // C. Working capital and revenue quality
  add('C1', 'Working capital', 'Medium', 'Debtor days up 30%+ over 3 years (and 5+ days)', () => {
    const a = at(s.debtorDays, 0), b = at(s.debtorDays, 3);
    return has(a, b) && b > 0 ? { flag: a > b * 1.3 && a - b >= 5, ev: 'Debtor days ' + b + ' to ' + a } : null;
  });
  add('C2', 'Working capital', 'Low', 'Debtor days rising 3 years in a row', () => {
    const d = lastN(s.debtorDays, 4);
    return d.length < 4 || !d.every(Number.isFinite) ? null : { flag: risingRun(s.debtorDays, 3), ev: 'Debtor days ' + d.join(', ') };
  });
  add('C3', 'Working capital', 'Medium', 'Inventory days up 30%+ over 3 years (and 10+ days)', () => {
    const a = at(s.invDays, 0), b = at(s.invDays, 3);
    return has(a, b) && b > 0 ? { flag: a > b * 1.3 && a - b >= 10, ev: 'Inventory days ' + b + ' to ' + a } : null;
  });
  add('C4', 'Working capital', 'Medium', 'Days payable up 30%+ over 3 years (stretching suppliers)', () => {
    const a = at(s.payDays, 0), b = at(s.payDays, 3);
    return has(a, b) && b > 0 ? { flag: a > b * 1.3 && a - b >= 10, ev: 'Days payable ' + b + ' to ' + a } : null;
  });
  add('C5', 'Working capital', 'Low', 'Days payable down 30%+ over 3 years (suppliers want cash earlier)', () => {
    const a = at(s.payDays, 0), b = at(s.payDays, 3);
    return has(a, b) && b > 0 ? { flag: a < b * 0.7 && b - a >= 10, ev: 'Days payable ' + b + ' to ' + a } : null;
  });
  add('C6', 'Working capital', 'Medium', 'Working capital days rising 3 years in a row (and up 10+ days)', () => {
    const w = lastN(s.wcDays, 4);
    if (w.length < 4 || !w.every(Number.isFinite)) return null;
    return { flag: risingRun(s.wcDays, 3) && w[3] - w[0] >= 10, ev: 'Working capital days ' + w.join(', ') };
  });
  add('C7', 'Working capital', 'Medium', 'Sales up 20%+ in the latest year while cash from operations fell', () => {
    const s0 = at(s.sales, 0), s1 = at(s.sales, 1), c0 = at(s.cfo, 0), c1 = at(s.cfo, 1);
    if (!has(s0, s1, c0, c1) || s1 <= 0) return null;
    return { flag: s0 / s1 > 1.2 && c0 < c1, ev: 'Sales ' + pct(s0 / s1 - 1) + ' growth; CFO ' + f1(c1) + ' to ' + f1(c0) };
  });
  add('C8', 'Working capital', 'Medium', 'Other assets growing 10+ points faster than sales (3-year CAGR)', () => {
    const o = cagr(s.otherAssets, 3), v = cagr(s.sales, 3);
    return has(o, v) ? { flag: o - v > 0.1, ev: 'Other assets ' + pct(o) + ' vs sales ' + pct(v) + ' a year' } : null;
  });

  // D. Leverage and solvency
  add('D1', 'Leverage', 'High', 'Debt to equity above 1.5', () => {
    const d = at(de, 0);
    return has(d) ? { flag: d > 1.5, ev: 'Debt/equity ' + (Math.round(d * 100) / 100) + 'x' } : null;
  });
  add('D2', 'Leverage', 'Medium', 'Debt to equity rising 3 years in a row', () => {
    const d = lastN(de, 4);
    return d.length < 4 || !d.every(Number.isFinite) ? null : { flag: risingRun(de, 3), ev: 'Debt/equity ' + d.map((x) => Math.round(x * 100) / 100).join(', ') };
  });
  add('D3', 'Leverage', 'Medium', 'Borrowings growing 10+ points faster than reserves (3-year CAGR)', () => {
    const b = cagr(s.borrow, 3), r = cagr(s.reserves, 3);
    return has(b, r) ? { flag: b - r > 0.1, ev: 'Borrowings ' + pct(b) + ' vs reserves ' + pct(r) + ' a year' } : null;
  });
  add('D4', 'Leverage', 'Medium', 'Borrowings growing 10+ points faster than operating profit (3-year CAGR)', () => {
    const b = cagr(s.borrow, 3), o = cagr(s.opProfit, 3);
    return has(b, o) ? { flag: b - o > 0.1, ev: 'Borrowings ' + pct(b) + ' vs operating profit ' + pct(o) + ' a year' } : null;
  });
  add('D5', 'Leverage', 'High', 'Borrowings above 3x operating profit', () => {
    const b = at(s.borrow, 0), o = at(s.opProfit, 0);
    if (!has(b, o)) return null;
    return { flag: o <= 0 || b / o > 3, ev: 'Borrowings: ' + (o > 0 ? (Math.round(b / o * 10) / 10) + 'x operating profit' : 'not meaningful (operating profit is zero or negative)') };
  });
  add('D6', 'Leverage', 'High', 'Interest cover (operating profit / interest) below 3x', () => {
    const o = at(s.opProfit, 0), i = at(s.interest, 0);
    if (!has(o, i) || i <= 0) return null;
    return { flag: o / i < 3, ev: 'Interest cover ' + (Math.round(o / i * 10) / 10) + 'x' };
  });
  add('D7', 'Leverage', 'Medium', 'Interest takes more than 40% of operating profit', () => {
    const o = at(s.opProfit, 0), i = at(s.interest, 0);
    if (!has(o, i) || o <= 0) return null;
    return { flag: i / o > 0.4, ev: 'Interest is ' + pct(i / o) + ' of operating profit' };
  });
  add('D8', 'Leverage', 'Medium', 'Interest cost falling while borrowings rise for 2 years (interest may be capitalised)', () => {
    const i = lastN(s.interest, 3), b = lastN(s.borrow, 3);
    if (i.length < 3 || !i.every(Number.isFinite) || !b.every(Number.isFinite)) return null;
    return { flag: i[1] < i[0] && i[2] < i[1] && b[1] > b[0] && b[2] > b[1], ev: 'Interest ' + i.map(f1).join(', ') + '; borrowings ' + b.map(f1).join(', ') };
  });
  add('D9', 'Leverage', 'Low', 'Other liabilities growing 15+ points faster than sales (3-year CAGR)', () => {
    const o = cagr(s.otherLiab, 3), v = cagr(s.sales, 3);
    return has(o, v) ? { flag: o - v > 0.15, ev: 'Other liabilities ' + pct(o) + ' vs sales ' + pct(v) + ' a year' } : null;
  });
  add('D10', 'Leverage', 'High', 'Reserves fell in the latest year despite positive net profit', () => {
    const r0 = at(s.reserves, 0), r1 = at(s.reserves, 1), n = at(s.np, 0);
    return has(r0, r1, n) ? { flag: r0 < r1 && n > 0, ev: 'Reserves ' + f1(r1) + ' to ' + f1(r0) + '; net profit ' + f1(n) } : null;
  });

  // E. Returns and efficiency
  add('E1', 'Returns', 'Medium', 'ROCE below 12% in each of the last 3 years', () => {
    const r = lastN(s.roce, 3);
    return r.length < 3 || !r.every(Number.isFinite) ? null : { flag: r.every((x) => x < 12), ev: 'ROCE ' + r.join('%, ') + '%' };
  });
  add('E2', 'Returns', 'Medium', 'ROCE falling 3 years in a row', () => {
    const r = lastN(s.roce, 4);
    return r.length < 4 || !r.every(Number.isFinite) ? null : { flag: fallingRun(s.roce, 3), ev: 'ROCE ' + r.join('%, ') + '%' };
  });
  add('E3', 'Returns', 'Medium', 'ROE falling 3 years while debt to equity rises (return propped up by debt)', () => {
    const roe = ratioSeries(s.np, equity), r = lastN(roe, 4);
    if (r.length < 4 || !r.every(Number.isFinite) || !lastN(de, 4).every(Number.isFinite)) return null;
    return { flag: fallingRun(roe, 3) && at(de, 0) > at(de, 3), ev: 'ROE ' + r.map(pct).join(', ') };
  });
  add('E4', 'Returns', 'Low', 'Asset turnover (sales / total assets) falling 3 years in a row', () => {
    const t = ratioSeries(s.sales, s.totalAssets), v = lastN(t, 4);
    return v.length < 4 || !v.every(Number.isFinite) ? null : { flag: fallingRun(t, 3), ev: 'Turnover ' + v.map((x) => Math.round(x * 100) / 100).join(', ') };
  });
  add('E5', 'Returns', 'Medium', 'Sales per rupee of fixed assets down 25%+ over 3 years', () => {
    const t = ratioSeries(s.sales, s.fixedAssets), a = at(t, 0), b = at(t, 3);
    return has(a, b) ? { flag: a < b * 0.75, ev: 'Fixed asset turnover ' + (Math.round(b * 100) / 100) + ' to ' + (Math.round(a * 100) / 100) } : null;
  });
  add('E6', 'Returns', 'Medium', 'New capital earns far less than old: 5-year change in (operating profit - depreciation) is under 5% of the change in total assets', () => {
    const ebit = s.opProfit.map((o, i) => (has(o, s.dep[i]) ? o - s.dep[i] : null));
    const dE = at(ebit, 0) - at(ebit, 5), dA = at(s.totalAssets, 0) - at(s.totalAssets, 5);
    if (!has(dE, dA) || dA <= 0) return null;
    return { flag: dE / dA < 0.05, ev: 'Incremental return ' + pct(dE / dA) + ' on added assets' };
  });

  // F. Margin and growth
  add('F1', 'Margin and growth', 'Low', 'Operating margin falling 3 years in a row', () => {
    const m = lastN(s.opm, 4);
    return m.length < 4 || !m.every(Number.isFinite) ? null : { flag: fallingRun(s.opm, 3), ev: 'OPM ' + m.join('%, ') + '%' };
  });
  add('F2', 'Margin and growth', 'Medium', 'Expenses growing faster than sales for 2 years', () => {
    const sa = lastN(s.sales, 3), ex = lastN(s.expenses, 3);
    if (sa.length < 3 || !sa.every(Number.isFinite) || !ex.every(Number.isFinite)) return null;
    const g = (v, i) => v[i] / v[i - 1] - 1;
    return { flag: g(ex, 1) > g(sa, 1) && g(ex, 2) > g(sa, 2), ev: 'Expenses ' + pct(g(ex, 2)) + ' vs sales ' + pct(g(sa, 2)) + ' in the latest year' };
  });
  add('F3', 'Margin and growth', 'Medium', 'Latest-year profit more than 50% above its 5-year average (possible peak earnings)', () => {
    const n = lastN(s.np, 5);
    if (n.length < 5 || !n.every(Number.isFinite)) return null;
    const avg = sum(n) / 5;
    return { flag: avg > 0 && n[4] > avg * 1.5, ev: 'Net profit ' + f1(n[4]) + ' vs 5-year average ' + f1(avg) };
  });

  // G. Ownership (quarterly shareholding table). Percentage-point changes are rounded to avoid float noise at the threshold.
  const pts = (v) => Math.round(v * 100) / 100;
  const holding = (arr) => lastN(arr, 12);
  const span = (arr) => {
    const h = holding(arr);
    return h.length < 9 || !h.every(Number.isFinite) ? null : h;
  };
  add('G1', 'Ownership', 'High', 'Promoter holding down 5+ points over the last 12 quarters', () => {
    const h = span(sh.promoters);
    return h ? { flag: pts(h[0] - h[h.length - 1]) >= 5, ev: 'Promoter holding ' + h[0] + '% to ' + h[h.length - 1] + '% over ' + h.length + ' quarters' } : null;
  });
  add('G2', 'Ownership', 'Medium', 'Promoter holding falling 4 quarters in a row', () => {
    const p = lastN(sh.promoters, 5);
    return p.length < 5 || !p.every(Number.isFinite) ? null : { flag: fallingRun(sh.promoters, 4), ev: 'Promoter holding ' + p.join('%, ') + '%' };
  });
  add('G3', 'Ownership', 'Medium', 'Promoter holding below 25% (weak control, or a professionally managed company)', () => {
    const p = at(sh.promoters, 0);
    return has(p) ? { flag: p < 25, ev: 'Promoter holding ' + p + '%' } : null;
  });
  add('G4', 'Ownership', 'Medium', 'FII and DII holding both falling 3 quarters in a row', () => {
    const f = lastN(sh.fii, 4), d = lastN(sh.dii, 4);
    if (f.length < 4 || !f.every(Number.isFinite) || !d.every(Number.isFinite)) return null;
    return { flag: fallingRun(sh.fii, 3) && fallingRun(sh.dii, 3), ev: 'FII ' + f.join('%, ') + '%; DII ' + d.join('%, ') + '%' };
  });
  add('G5', 'Ownership', 'Low', 'Public holding up 5+ points over the last 12 quarters (shares moving to retail)', () => {
    const h = span(sh.pub);
    return h ? { flag: pts(h[h.length - 1] - h[0]) >= 5, ev: 'Public holding ' + h[0] + '% to ' + h[h.length - 1] + '% over ' + h.length + ' quarters' } : null;
  });

  add('G6', 'Ownership', 'High', 'More than 10% of promoter shares pledged (NSE disclosure)', () => {
    return has(x.pledge) ? { flag: x.pledge > 10, ev: x.pledge + '% of promoter shares pledged as of ' + x.pledgeDate } : null;
  });

  // H. Valuation and market signals (top ratios block)
  const top = (name, k) => (ratios && ratios[name] ? ratios[name][k || 0] : null);
  add('H1', 'Valuation', 'Medium', 'Price to book above 5 with ROE under 12%', () => {
    const price = top('Current Price'), bv = top('Book Value'), roe = top('ROE');
    if (!has(price, bv, roe) || bv <= 0) return null;
    const pb = price / bv;
    return { flag: pb > 5 && roe < 12, ev: 'Price/book ' + (Math.round(pb * 10) / 10) + 'x, ROE ' + roe + '%' };
  });
  add('H2', 'Valuation', 'Medium', 'Dividend yield above 8% with payout above 100% (unsustainable)', () => {
    const y = top('Dividend Yield'), p = at(s.payout, 0);
    return has(y, p) ? { flag: y > 8 && p > 100, ev: 'Dividend yield ' + y + '%, payout ' + p + '% of profit' } : null;
  });
  add('H3', 'Valuation', 'Low', 'Price more than 30% below the 52-week high', () => {
    const price = top('Current Price'), high = top('High / Low', 0);
    if (!has(price, high) || high <= 0) return null;
    return { flag: 1 - price / high > 0.3, ev: 'Price ' + price + ' vs 52-week high ' + high + ' (' + pct(1 - price / high) + ' below)' };
  });
  add('H4', 'Valuation', 'Medium', 'P/E more than 3x the 3-year profit growth rate (PEG above 3)', () => {
    const pe = top('Stock P/E'), g = cagr(s.np, 3);
    if (!has(pe, g) || pe <= 0 || g <= 0) return null;
    return { flag: pe / (g * 100) > 3, ev: 'P/E ' + pe + ' vs profit growth ' + pct(g) + ' a year (PEG ' + (Math.round(pe / (g * 100) * 10) / 10) + ')' };
  });

  add('H5', 'Valuation', 'Medium', 'P/E more than 2x its own 5-year median', () => {
    const pe = top('Stock P/E');
    if (!has(pe, x.medianPe) || pe <= 0 || x.medianPe <= 0) return null;
    return { flag: pe > 2 * x.medianPe, ev: 'P/E ' + pe + ' vs 5-year median ' + x.medianPe };
  });
  add('H6', 'Valuation', 'Low', 'Price down 20%+ over the past year while the latest annual net profit rose', () => {
    const n0 = at(s.np, 0), n1 = at(s.np, 1);
    if (!has(x.priceChange, n0, n1)) return null;
    return { flag: Math.round(x.priceChange * 10000) / 10000 <= -0.2 && n0 > n1, ev: 'Price ' + pct(x.priceChange) + ' in a year; net profit ' + f1(n1) + ' to ' + f1(n0) };
  });
  add('H7', 'Valuation', 'Medium', 'P/E more than 50% above the median of screener.in peers', () => {
    const pe = top('Stock P/E');
    if (!has(pe) || pe <= 0 || x.peerPe.length < 4) return null;
    const sorted = [...x.peerPe].sort((a, b) => a - b), m = sorted.length / 2;
    const med = sorted.length % 2 ? sorted[Math.floor(m)] : (sorted[m - 1] + sorted[m]) / 2;
    return { flag: pe > 1.5 * med, ev: 'P/E ' + pe + ' vs peer median ' + (Math.round(med * 10) / 10) + ' (' + x.peerPe.length + ' peers)' };
  });

  // Q. Latest quarter vs the same quarter a year earlier (removes seasonality)
  add('Q1', 'Quarterly', 'Medium', 'Operating margin down 5+ points vs the same quarter last year', () => {
    const a = at(q.opm, 0), b = at(q.opm, 4);
    return has(a, b) ? { flag: pts(a - b) <= -5, ev: 'OPM ' + b + '% to ' + a + '%' } : null;
  });
  add('Q2', 'Quarterly', 'Medium', 'Net profit down 20%+ vs the same quarter last year', () => {
    const a = at(q.np, 0), b = at(q.np, 4);
    if (!has(a, b) || b <= 0) return null;
    return { flag: Math.round((a / b - 1) * 10000) / 10000 <= -0.2, ev: 'Quarterly net profit ' + f1(b) + ' to ' + f1(a) + ' (' + pct(a / b - 1) + ')' };
  });
  add('Q3', 'Quarterly', 'Medium', 'Other income above 20% of the latest quarter\'s profit before tax', () => {
    const o = at(q.otherInc, 0), p = at(q.pbt, 0);
    if (!has(o, p) || p <= 0) return null;
    return { flag: o / p > 0.2, ev: 'Other income is ' + pct(o / p) + ' of quarterly PBT' };
  });
  add('Q4', 'Quarterly', 'Low', 'Year-on-year sales growth slowing 3 quarters in a row', () => {
    const base = lastN(q.sales, 8), growth = [];
    if (base.length < 8 || !base.every((x) => Number.isFinite(x) && x > 0)) return null;
    for (let i = 4; i < 8; i++) growth.push(base[i] / base[i - 4] - 1);
    return { flag: growth.every((g, i) => i === 0 || g < growth[i - 1]), ev: 'Sales growth ' + growth.map(pct).join(', ') };
  });
  return checks;
}

function runChecks(html, extras) {
  const parsed = parseCompany(html);
  if (!parsed.data['profit-loss']) return { error: 'Could not find financial tables. Check the ticker.' };
  if (!findRow(parsed.data['profit-loss'], 'Operating Profit')) {
    return { error: 'This looks like a bank, NBFC or insurer. V2 only supports non-financial companies.' };
  }
  const built = buildSeries(parsed);
  if (!built || built.years.length < 6) return { error: 'Not enough annual history (need at least 6 years).' };
  const rows = buildChecks(built, parseExtras(extras)).map((c) => {
    let res = null;
    try { res = c.fn(); } catch (e) { res = null; }
    const status = res === null ? 'Not tested' : res.flag ? 'FLAG' : 'OK';
    return { Status: status, Severity: c.severity, Section: c.section, Check: c.id + '. ' + c.name, Evidence: res === null ? 'Not testable (row missing or value zero/negative)' : res.ev };
  });
  const order = { FLAG: 0, OK: 1, 'Not tested': 2 };
  const sev = { High: 0, Medium: 1, Low: 2 };
  rows.sort((a, b) => order[a.Status] - order[b.Status] || sev[a.Severity] - sev[b.Severity]);
  return { company: parsed.company, latestYear: built.years[built.years.length - 1], rows };
}

if (typeof module !== 'undefined') module.exports = { runChecks, parseCompany, buildSeries };
