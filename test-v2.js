// V2 checks (G ownership, H valuation, Q quarterly) against synthetic screener-style pages.
// Run: node test-v2.js
const { runChecks } = require('./engine');

const tr = (label, vals) => '<tr><td class="text">' + label + '&nbsp;+</td>' + vals.map((v) => '<td>' + v + '</td>').join('') + '</tr>';
const table = (years, rows) =>
  '<table><thead><tr><th class="text"></th>' + years.map((y) => '<th>' + y + '</th>').join('') + '</tr></thead><tbody>' +
  Object.entries(rows).map(([k, v]) => tr(k, v)).join('') + '</tbody></table>';
const section = (id, years, rows) => '<section id="' + id + '">' + table(years, rows) + '</section>';
const flat = (n, v) => Array(n).fill(v);
const ramp = (from, to, n) => Array.from({ length: n }, (_, i) => Math.round((from + ((to - from) * i) / (n - 1)) * 100) / 100);

const YEARS = ['Mar 2017', 'Mar 2018', 'Mar 2019', 'Mar 2020', 'Mar 2021', 'Mar 2022', 'Mar 2023', 'Mar 2024', 'Mar 2025', 'Mar 2026'];
const QTRS = ['Jun 2023', 'Sep 2023', 'Dec 2023', 'Mar 2024', 'Jun 2024', 'Sep 2024', 'Dec 2024', 'Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026'];

// A calm baseline company: every V2 check should be OK.
function page(over) {
  const o = Object.assign({
    promoters: flat(12, 55), fii: flat(12, 10), dii: flat(12, 10), pub: flat(12, 25),
    qOpm: flat(12, 20), qNp: flat(12, 100), qSales: flat(4, 100).concat(flat(4, 200), flat(4, 400)), qOther: flat(12, 5), qPbt: flat(12, 130),
    price: 150, high: 160, pe: 12, bv: 50, dy: 2, roe: 18, payout: 30,
  }, over || {});
  const top = '<ul id="top-ratios">' +
    [['Current Price', o.price], ['High / Low', o.high + '</span> / <span class="number">100'], ['Stock P/E', o.pe], ['Book Value', o.bv], ['Dividend Yield', o.dy], ['ROE', o.roe]]
      .map(([n, v]) => '<li><span class="name"> ' + n + ' </span><span class="nowrap value"><span class="number">' + v + '</span></span></li>').join('') + '</ul>';
  const a = (v) => ramp(v, v, YEARS.length);
  const pl = section('profit-loss', YEARS, {
    Sales: ramp(1000, 2000, 10), Expenses: ramp(800, 1600, 10), 'Operating Profit': ramp(200, 400, 10), 'OPM %': a(20), 'Other Income': a(10),
    Interest: a(10), Depreciation: a(30), 'Profit before tax': ramp(160, 360, 10), 'Tax %': a(25), 'Net Profit': ramp(120, 270, 10), 'EPS in Rs': ramp(12, 27, 10),
    'Dividend Payout %': a(o.payout),
  });
  const bs = section('balance-sheet', YEARS, {
    'Equity Capital': a(100), Reserves: ramp(500, 1500, 10), Borrowings: a(300), 'Other Liabilities': a(200), 'Fixed Assets': a(600), CWIP: a(50),
    Investments: a(100), 'Other Assets': a(500), 'Total Assets': a(1250),
  });
  const cf = section('cash-flow', YEARS, { 'Cash from Operating Activity': ramp(150, 300, 10), 'Cash from Investing Activity': a(-100), 'Cash from Financing Activity': a(-50), 'Free Cash Flow': a(100) });
  const ra = section('ratios', YEARS, { 'Debtor Days': a(30), 'Inventory Days': a(40), 'Days Payable': a(30), 'Working Capital Days': a(40), 'ROCE %': a(18) });
  const qs = section('quarters', QTRS, { Sales: o.qSales, 'OPM %': o.qOpm, 'Other Income': o.qOther, 'Profit before tax': o.qPbt, 'Net Profit': o.qNp });
  const sh = section('shareholding', QTRS, { Promoters: o.promoters, FIIs: o.fii, DIIs: o.dii, Public: o.pub, 'No. of Shareholders': flat(12, '1,000') });
  return '<h1>Test Co</h1>' + top + qs + pl + bs + cf + ra + sh;
}

// Extra-source payloads, shaped like the raw text the n8n HTTP nodes return.
function extras(over) {
  const o = Object.assign({ median: 10, pe: 12, priceStart: 100, priceEnd: 100, peers: [8, 9, 10, 11, 12], pledge: '0.00' }, over || {});
  return {
    pe: JSON.stringify({ datasets: [{ metric: 'Median PE', values: [['2021-10-29', String(o.median)], ['2026-10-22', String(o.median)]] }] }),
    price: JSON.stringify({ datasets: [{ metric: 'Price', values: [['2025-10-23', String(o.priceStart)], ['2026-10-22', String(o.priceEnd)]] }] }),
    peers: '<table><tbody><tr><th>S.No.</th><th>Company</th><th>CMP Rs.</th><th>P/E</th></tr>' +
      o.peers.map((p, i) => '<tr><td>' + (i + 1) + '.</td><td>Peer ' + i + '</td><td>100</td><td>' + p + '</td></tr>').join('') +
      '<tr><td colspan="2">Median: 5 Co.</td><td>100</td><td>99</td></tr></tbody></table>',
    pledge: JSON.stringify({ data: [{ percPromoterShares: '    ' + o.pledge, shp: '30-Sep-2026' }] }),
  };
}

let failed = 0;
const status = (html, id, ex) => {
  const out = runChecks(html, ex);
  if (out.error) throw new Error(out.error);
  const row = out.rows.find((r) => r.Check.startsWith(id + '. '));
  return row ? row.Status : 'MISSING';
};
const expect = (name, html, id, want, ex) => {
  const got = status(html, id, ex);
  if (got !== want) { failed += 1; console.log('FAIL', name, '-> ' + id + ' wanted ' + want + ' got ' + got); } else console.log('ok  ', name);
};

const base = page();
for (const id of ['G1', 'G2', 'G3', 'G4', 'G5', 'H1', 'H2', 'H3', 'H4', 'Q1', 'Q2', 'Q3', 'Q4']) expect('baseline ' + id + ' OK', base, id, 'OK');

expect('G1 promoter down 5 points', page({ promoters: ramp(60, 55, 12) }), 'G1', 'FLAG');
expect('G1 promoter down 4 points', page({ promoters: ramp(60, 56, 12) }), 'G1', 'OK');
expect('G2 promoter falling 4 quarters', page({ promoters: flat(8, 55).concat([54.9, 54.8, 54.7, 54.6]) }), 'G2', 'FLAG');
expect('G2 promoter falling 3 quarters only', page({ promoters: flat(9, 55).concat([54.9, 54.8, 54.7]) }), 'G2', 'OK');
expect('G3 promoter below 25', page({ promoters: flat(12, 24.9) }), 'G3', 'FLAG');
expect('G3 promoter at 25', page({ promoters: flat(12, 25) }), 'G3', 'OK');
expect('G4 FII and DII both falling 3 quarters', page({ fii: flat(9, 10).concat([9.9, 9.8, 9.7]), dii: flat(9, 10).concat([9.9, 9.8, 9.7]) }), 'G4', 'FLAG');
expect('G4 only FII falling', page({ fii: flat(9, 10).concat([9.9, 9.8, 9.7]) }), 'G4', 'OK');
expect('G5 public up 5 points', page({ pub: ramp(25, 30, 12) }), 'G5', 'FLAG');
expect('G5 public up 4 points', page({ pub: ramp(25, 29, 12) }), 'G5', 'OK');

expect('H1 P/B 6 with ROE 10', page({ price: 300, bv: 50, roe: 10 }), 'H1', 'FLAG');
expect('H1 P/B 6 with ROE 20', page({ price: 300, bv: 50, roe: 20 }), 'H1', 'OK');
expect('H1 P/B 4 with ROE 10', page({ price: 200, bv: 50, roe: 10 }), 'H1', 'OK');
expect('H2 yield 9 payout 120', page({ dy: 9, payout: 120 }), 'H2', 'FLAG');
expect('H2 yield 9 payout 90', page({ dy: 9, payout: 90 }), 'H2', 'OK');
expect('H3 price 31% below high', page({ price: 110, high: 160 }), 'H3', 'FLAG');
expect('H3 price 25% below high', page({ price: 120, high: 160 }), 'H3', 'OK');
expect('H4 PEG above 3', page({ pe: 60 }), 'H4', 'FLAG');
expect('H4 PEG below 3', page({ pe: 20 }), 'H4', 'OK');

expect('Q1 OPM down 5 vs year ago', page({ qOpm: flat(11, 20).concat([15]) }), 'Q1', 'FLAG');
expect('Q1 OPM down 4 vs year ago', page({ qOpm: flat(11, 20).concat([16]) }), 'Q1', 'OK');
expect('Q2 profit down 20 percent', page({ qNp: flat(11, 100).concat([80]) }), 'Q2', 'FLAG');
expect('Q2 profit down 19 percent', page({ qNp: flat(11, 100).concat([81]) }), 'Q2', 'OK');
expect('Q3 other income 21 percent of PBT', page({ qOther: flat(11, 5).concat([21]), qPbt: flat(12, 100) }), 'Q3', 'FLAG');
expect('Q3 other income 19 percent of PBT', page({ qOther: flat(11, 5).concat([19]), qPbt: flat(12, 100) }), 'Q3', 'OK');
// Sales growth YoY over last four quarters: 40%, 30%, 20%, 10% (3 slowdowns).
const slow = flat(8, 100).concat([140, 130, 120, 110]);
expect('Q4 growth slowing 3 quarters', page({ qSales: slow }), 'Q4', 'FLAG');
expect('Q4 growth steady', page({ qSales: flat(8, 100).concat([110, 110, 110, 110]) }), 'Q4', 'OK');

expect('missing shareholding -> Not tested', base.replace(/<section id="shareholding">[\s\S]*?<\/section>/, ''), 'G1', 'Not tested');
expect('missing top ratios -> Not tested', base.replace(/<ul id="top-ratios">[\s\S]*?<\/ul>/, ''), 'H3', 'Not tested');
expect('missing quarters -> Not tested', base.replace(/<section id="quarters">[\s\S]*?<\/section>/, ''), 'Q1', 'Not tested');

// Extra sources: G6 pledge, H5 median P/E, H6 price vs profit, H7 peers. base page has P/E 12 and rising profit.
for (const id of ['G6', 'H5', 'H6', 'H7']) expect('baseline ' + id + ' OK', base, id, 'OK', extras());
expect('G6 pledge 10.1 percent', base, 'G6', 'FLAG', extras({ pledge: '10.1' }));
expect('G6 pledge 10 percent', base, 'G6', 'OK', extras({ pledge: '10.00' }));
expect('H5 P/E above 2x median', base, 'H5', 'FLAG', extras({ median: 5.9 }));
expect('H5 P/E at 2x median', base, 'H5', 'OK', extras({ median: 6 }));
expect('H6 price down 20 percent, profit up', base, 'H6', 'FLAG', extras({ priceEnd: 80 }));
expect('H6 price down 19 percent, profit up', base, 'H6', 'OK', extras({ priceEnd: 81 }));
expect('H6 price up', base, 'H6', 'OK', extras({ priceEnd: 150 }));
expect('H7 P/E 50 percent over peer median', base, 'H7', 'FLAG', extras({ peers: [7, 7, 7, 8, 8] }));
expect('H7 P/E 33 percent over peer median', base, 'H7', 'OK', extras({ peers: [8, 8, 9, 9, 9] }));
expect('H7 too few peers', base, 'H7', 'Not tested', extras({ peers: [7, 7, 8] }));
for (const id of ['G6', 'H5', 'H6', 'H7']) expect('no extras -> ' + id + ' Not tested', base, id, 'Not tested');
expect('garbage extras -> Not tested', base, 'G6', 'Not tested', { pe: 'x', price: '<html>', peers: '', pledge: 'Access Denied' });

const total = runChecks(base).rows.length;
if (total !== 61) { failed += 1; console.log('FAIL total checks wanted 61 got ' + total); }
console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
