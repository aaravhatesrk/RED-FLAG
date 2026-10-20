const { runChecks } = require('./engine');
const https = require('https');
const get = (t, mode) => new Promise((res, rej) => https.get('https://www.screener.in/company/' + t + '/' + (mode || 'consolidated/'), { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ code: r.statusCode, d })); }).on('error', rej));
(async () => {
  for (const t of process.argv.slice(2)) {
    const { code, d } = await get(t);
    const out = runChecks(d);
    console.log('\n=== ' + t + ' http ' + code + ' ===');
    if (out.error) { console.log(out.error); continue; }
    const c = {}; out.rows.forEach((r) => (c[r.Status] = (c[r.Status] || 0) + 1));
    console.log(out.company, out.latestYear, JSON.stringify(c));
    out.rows.filter((r) => r.Status !== 'OK').forEach((r) => console.log(r.Status.padEnd(10), r.Severity.padEnd(6), r.Check.slice(0, 70), '|', r.Evidence));
    await new Promise((r) => setTimeout(r, 1500));
  }
})();
