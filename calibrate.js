// Scores the locked calibration set with the live screener sources and writes calibration-results.json.
// Run: node calibrate.js [labels.json] [results.json]   (one company at a time, slow on purpose)
const LABELS_FILE = process.argv[2] || 'calibration-labels.json';
const RESULTS_FILE = process.argv[3] || 'calibration-results.json';
const fs = require('fs');
const { runChecks } = require('./engine');
const { scoreRows } = require('./score');
const https = require('https');

const get = (url, headers) => new Promise((res, rej) => https.get(url, { headers: Object.assign({ 'User-Agent': 'Mozilla/5.0' }, headers || {}), timeout: 20000 }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ code: r.statusCode, d })); }).on('error', rej));
const ajax = { 'X-Requested-With': 'XMLHttpRequest' };
const safe = async (url, headers) => { try { const r = await get(url, headers); return r.code === 200 ? r.d : null; } catch (e) { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NSE_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', Accept: '*/*', Referer: 'https://www.nseindia.com/' };

// screener.in answers 429 when hit too fast; wait and retry instead of parsing the error page.
async function getPage(url) {
  for (const wait of [0, 45000, 90000, 150000]) {
    if (wait) { console.log('  429, waiting ' + wait / 1000 + 's'); await sleep(wait); }
    const r = await get(url);
    if (r.code !== 429) return r;
  }
  throw new Error('still rate limited (429)');
}

async function screen(t, consolidated) {
  const { d } = await getPage('https://www.screener.in/company/' + t + '/' + (consolidated ? 'consolidated/' : ''));
  const cid = (d.match(/data-company-id="(\d+)"/) || [])[1], wid = (d.match(/data-warehouse-id="(\d+)"/) || [])[1];
  const api = 'https://www.screener.in/api/company/', c = consolidated ? 'true' : 'false';
  const extras = {
    pe: await sleep(2500) || await safe(api + cid + '/chart/?q=Price+to+Earning-Median+PE-EPS&days=1825&consolidated=' + c, ajax),
    price: await sleep(2500) || await safe(api + cid + '/chart/?q=Price&days=365&consolidated=' + c, ajax),
    peers: await sleep(2500) || await safe(api + wid + '/peers/', ajax),
    pledge: await sleep(2500) || await safe('https://www.nseindia.com/api/corporate-pledgedata?index=equities&symbol=' + encodeURIComponent(t), NSE_HEADERS),
  };
  return runChecks(d, extras);
}

(async () => {
  const labels = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8'));
  // Resume: keep companies already scored, redo errors.
  const prior = fs.existsSync(RESULTS_FILE) ? JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')) : [];
  const results = prior.filter((r) => r.score !== undefined);
  const done = new Set(results.map((r) => r.ticker));
  for (const label of ['GOOD', 'MODERATE', 'BAD']) {
    for (const t of labels[label]) {
      if (done.has(t)) continue;
      let out = await screen(t, true);
      let mode = 'consolidated';
      if (out.error && /^(Could not find|Not enough annual|This looks like a bank)/.test(out.error)) { await sleep(3000); out = await screen(t, false); mode = 'standalone'; }
      if (out.error) { results.push({ label, ticker: t, error: out.error }); console.log(label.padEnd(9), t.padEnd(11), 'ERROR', out.error); continue; }
      const s = scoreRows(out.rows);
      results.push({ label, ticker: t, company: out.company, mode, latestYear: out.latestYear, score: s.score, flags: s.flags, highFlags: s.highFlags, coverage: s.coverage });
      console.log(label.padEnd(9), t.padEnd(11), String(s.score).padStart(5), 'flags', s.flags, 'high', s.highFlags, 'coverage', s.coverage + '%', mode);
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
      await sleep(4000);
    }
  }
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
})();
