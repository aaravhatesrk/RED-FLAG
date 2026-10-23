const { runChecks } = require('./engine');
const https = require('https');
const get = (url, headers) => new Promise((res, rej) => https.get(url, { headers: Object.assign({ 'User-Agent': 'Mozilla/5.0' }, headers || {}), timeout: 20000 }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ code: r.statusCode, d })); }).on('error', rej));
const ajax = { 'X-Requested-With': 'XMLHttpRequest' };
// Same four extra calls the n8n workflow makes; a failure leaves that source empty ("Not tested").
const safe = async (url, headers) => { try { const r = await get(url, headers); return r.code === 200 ? r.d : null; } catch (e) { return null; } };
(async () => {
  for (const t of process.argv.slice(2)) {
    const { code, d } = await get('https://www.screener.in/company/' + t + '/consolidated/');
    const cid = (d.match(/data-company-id="(\d+)"/) || [])[1], wid = (d.match(/data-warehouse-id="(\d+)"/) || [])[1];
    const api = 'https://www.screener.in/api/company/';
    const extras = {
      pe: await safe(api + cid + '/chart/?q=Price+to+Earning-Median+PE-EPS&days=1825&consolidated=true', ajax),
      price: await safe(api + cid + '/chart/?q=Price&days=365&consolidated=true', ajax),
      peers: await safe(api + wid + '/peers/', ajax),
      pledge: await safe('https://www.nseindia.com/api/corporate-pledgedata?index=equities&symbol=' + encodeURIComponent(t), { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', Accept: '*/*', Referer: 'https://www.nseindia.com/' }),
    };
    const out = runChecks(d, extras);
    console.log('\n=== ' + t + ' http ' + code + ' ===');
    if (out.error) { console.log(out.error); continue; }
    const c = {}; out.rows.forEach((r) => (c[r.Status] = (c[r.Status] || 0) + 1));
    console.log(out.company, out.latestYear, JSON.stringify(c));
    out.rows.filter((r) => r.Status !== 'OK').forEach((r) => console.log(r.Status.padEnd(10), r.Severity.padEnd(6), r.Check.slice(0, 70), '|', r.Evidence));
    await new Promise((r) => setTimeout(r, 1500));
  }
})();
