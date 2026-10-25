import json

def strip_exports(path):
    return open(path, encoding='utf8').read().split("if (typeof module")[0]

engine = strip_exports('engine.js')
score = strip_exports('score.js')
writer = strip_exports('xlsx-writer-v3.js')

parse = score + """
const parsed = parseTickers($input.first().json['Tickers'], MAX_TICKERS);
const mode = String($input.first().json['Statements'] || '').toLowerCase().startsWith('standalone') ? 'standalone' : 'consolidated';
if (!parsed.tickers.length) return [{ json: { ticker: '', mode, dropped: [], error: 'No valid ticker found in the list.' } }];
return parsed.tickers.map((ticker) => ({ json: { ticker, mode, dropped: parsed.dropped } }));
"""

prep = """
const html = String($input.item.json.data || '');
const meta = $('Parse tickers').item.json;
const cid = (html.match(/data-company-id="(\\d+)"/) || [])[1] || '';
const wid = (html.match(/data-warehouse-id="(\\d+)"/) || [])[1] || '';
return { json: { cid, wid, ticker: meta.ticker, consolidated: meta.mode === 'consolidated' } };
"""

runner = """
const meta = $('Parse tickers').item.json;
const fail = (msg) => ({ json: { ticker: meta.ticker, error: msg + ' (' + meta.mode + ')' } });
if (meta.error) return fail(meta.error);
const html = String($('Fetch screener page').item.json.data || '');
// A real company page is 100KB+; a tiny reply is almost always screener.in throttling (HTTP 429).
if (html.length < 5000) return fail('screener.in sent back a page too small to be a company page, usually throttling (HTTP 429). Wait a few minutes and run fewer tickers at a time.');
// A failed or blocked extra call leaves that source null, so its checks show "Not tested".
const grab = (name) => { try { const d = $(name).item.json.data; return typeof d === 'string' ? d : null; } catch (e) { return null; } };
let out;
try {
  out = runChecks(html, { pe: grab('Fetch P/E history'), price: grab('Fetch price history'), peers: grab('Fetch peers'), pledge: grab('Fetch promoter pledge') });
} catch (e) {
  return fail('Unexpected page layout: ' + e.message);
}
// Some companies have no consolidated history on screener.in (a thin table or none at all); standalone has the full record.
if (out.error) return fail(out.error + (meta.mode === 'consolidated' && /^(Could not find|Not enough annual|This looks like a bank)/.test(out.error) ? ' If the company is not a bank and its consolidated accounts are missing or short, retry it with Standalone.' : ''));
return { json: Object.assign({ ticker: meta.ticker, company: out.company, latestYear: out.latestYear, rows: out.rows }, scoreRows(out.rows)) };
"""

excel = """
const items = $input.all().map((i) => i.json);
const meta = $('Parse tickers').first().json;
const store = $getWorkflowStaticData('global');
store.scores = store.scores || {};

const topFlags = (rows) => rows.filter((r) => r.Status === 'FLAG').slice(0, 3).map((r) => r.Check.slice(0, 60)).join('; ') || 'None';
const ranked = items.filter((r) => !r.error).sort((a, b) => (b.score === null) - (a.score === null) || b.score - a.score || b.highFlags - a.highFlags);
const failed = items.filter((r) => r.error);

const rankingRows = ranked.map((r, i) => ({
  Rank: i + 1, Ticker: r.ticker, Company: r.company, Score: r.score === null ? '' : r.score, Band: r.band, Flags: r.flags, HighFlags: r.highFlags,
  Coverage: r.coverage, Change: changeText(store.scores[r.ticker], r.score), TopFlags: topFlags(r.rows),
})).concat(failed.map((r) => ({ Rank: '', Ticker: r.ticker, Company: '', Score: '', Band: 'Unrated', Flags: '', HighFlags: '', Coverage: '', Change: '', TopFlags: r.error })))
  .concat((meta.dropped || []).map((t) => ({ Rank: '', Ticker: t, Company: '', Score: '', Band: 'Unrated', Flags: '', HighFlags: '', Coverage: '', Change: '', TopFlags: 'Skipped: over the ' + MAX_TICKERS + '-ticker limit, run it separately' })));

const note = {
  Status: 'SUMMARY', Severity: '', Section: '', Check: 'How to read the score', Evidence: 'Score = share of tested checks flagged, weighted High 3, Medium 2, Low 1. Bands: under 10 Low, 10-17.5 Moderate, 17.5-30 High, 30+ Very high. Cut-offs are provisional, fitted on about 30 companies I labelled good, moderate or bad beforehand; the score separates clean from stressed companies better than it separates good from moderate. A flag means look closer, not that the company is bad. Source: screener.in. Not investment advice.',
};
const detailSheets = ranked.map((r) => ({
  name: r.ticker, type: 'detail',
  rows: [{ Status: 'SUMMARY', Severity: '', Section: '', Check: r.company + ', latest year ' + r.latestYear + ': risk score ' + (r.score === null ? 'n/a' : r.score) + ' (' + r.band + '), ' + r.flags + ' flagged, ' + r.coverage + '% of checks tested', Evidence: 'Section scores: ' + Object.keys(r.sections).map((k) => k + ' ' + (r.sections[k] === null ? 'n/a' : r.sections[k])).join(', ') }].concat(r.rows),
}));
const sheets = [{ name: 'Ranking', type: 'ranking', rows: rankingRows }].concat(detailSheets);

ranked.forEach((r) => { if (r.score !== null) store.scores[r.ticker] = r.score; });

const buf = buildXlsx(sheets);
const fileName = 'red-flag-watchlist-' + new Date().toISOString().slice(0, 10) + '.xlsx';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
return [{ json: { fileName, tickers: ranked.length, failed: failed.length }, binary: { data: await this.helpers.prepareBinaryData(buf, fileName, mime) } }];
"""


def n(name, typ, ver, params, pos, **kw):
    d = {"parameters": params, "id": kw.pop("id"), "name": name, "type": typ, "typeVersion": ver, "position": pos}
    d.update(kw)
    return d


def batching(interval):
    # One ticker at a time with a pause: screener.in and NSE throttle bursts.
    return {"batching": {"batch": {"batchSize": 1, "batchInterval": interval}}}


def api(name, url, pos, nid, extra_headers=None, interval=1000):
    # NSE rejects requests without an Accept header (403 Access Denied).
    hdrs = [{"name": "User-Agent", "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}, {"name": "Accept", "value": "*/*"}] + (extra_headers or [])
    opts = {"response": {"response": {"neverError": True, "responseFormat": "text"}}, "timeout": 20000}
    opts.update(batching(interval))
    return n(name, "n8n-nodes-base.httpRequest", 4.2, {
        "url": url, "sendHeaders": True, "headerParameters": {"parameters": hdrs}, "options": opts},
        pos, id=nid, onError="continueRegularOutput")


AJAX = [{"name": "X-Requested-With", "value": "XMLHttpRequest"}]
SCR = "=https://www.screener.in/api/company/"
P = "$('Prepare extras').item.json"

nodes = [
    n("Watchlist form", "n8n-nodes-base.formTrigger", 2.2, {
        "formTitle": "Red-flag screener (V3, watchlist)",
        "formDescription": "Paste up to 10 NSE/BSE symbols of non-financial Indian companies (for example IOC, RELIANCE, IDEA), separated by commas, spaces or new lines. Each company gets the 61 checks and a weighted risk score. You get one Excel file: a Ranking sheet (riskiest first, with change versus the last run) plus a detail sheet per company. Extra sources (screener peers and price APIs, NSE pledge data) are optional: if one is unavailable its checks show Not tested. Runs one company at a time, so allow about 20 seconds per company.",
        "formFields": {"values": [
            {"fieldLabel": "Tickers", "fieldType": "textarea", "placeholder": "IOC, RELIANCE, IDEA", "requiredField": True},
            {"fieldLabel": "Statements", "fieldType": "dropdown", "fieldOptions": {"values": [{"option": "Consolidated"}, {"option": "Standalone"}]}, "requiredField": False}]},
        "options": {}}, [0, 0], id="rf3-0001", webhookId="c2d4e6f8-0301-4a00-8000-0000000000aa"),
    n("Parse tickers", "n8n-nodes-base.code", 2, {"jsCode": parse.strip()}, [220, 0], id="rf3-0002"),
    n("Fetch screener page", "n8n-nodes-base.httpRequest", 4.2, {
        "url": "=https://www.screener.in/company/{{ encodeURIComponent($json.ticker) }}/{{ $json.mode === 'consolidated' ? 'consolidated/' : '' }}",
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "User-Agent", "value": "Mozilla/5.0"}]},
        "options": dict({"response": {"response": {"neverError": True, "responseFormat": "text"}}, "timeout": 30000}, **batching(2000))},
        [440, 0], id="rf3-0003", onError="continueRegularOutput"),
    n("Prepare extras", "n8n-nodes-base.code", 2, {"mode": "runOnceForEachItem", "jsCode": prep.strip()}, [660, 0], id="rf3-0004"),
    api("Fetch P/E history", SCR + "{{ " + P + ".cid }}/chart/?q=Price+to+Earning-Median+PE-EPS&days=1825&consolidated={{ " + P + ".consolidated }}", [880, 0], "rf3-0005", AJAX),
    api("Fetch price history", SCR + "{{ " + P + ".cid }}/chart/?q=Price&days=365&consolidated={{ " + P + ".consolidated }}", [1100, 0], "rf3-0006", AJAX),
    api("Fetch peers", SCR + "{{ " + P + ".wid }}/peers/", [1320, 0], "rf3-0007", AJAX),
    api("Fetch promoter pledge", "=https://www.nseindia.com/api/corporate-pledgedata?index=equities&symbol={{ encodeURIComponent(" + P + ".ticker) }}", [1540, 0], "rf3-0008", [{"name": "Referer", "value": "https://www.nseindia.com/"}], interval=1500),
    n("Run checks and score", "n8n-nodes-base.code", 2, {"mode": "runOnceForEachItem", "jsCode": (engine + score + runner).strip()}, [1760, 0], id="rf3-0009"),
    n("Build workbook", "n8n-nodes-base.code", 2, {"jsCode": (score + writer + excel).strip()}, [1980, 0], id="rf3-0010"),
    n("Download Excel", "n8n-nodes-base.form", 1, {
        "operation": "completion", "completionTitle": "Your red-flag watchlist is ready",
        "respondWith": "returnBinary", "inputDataFieldName": "data", "options": {}}, [2200, 0], id="rf3-0011", webhookId="c2d4e6f8-0311-4a00-8000-0000000000cc"),
]
chain = ["Watchlist form", "Parse tickers", "Fetch screener page", "Prepare extras", "Fetch P/E history", "Fetch price history",
         "Fetch peers", "Fetch promoter pledge", "Run checks and score", "Build workbook", "Download Excel"]
conn = {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(chain, chain[1:])}
wf = {"id": "RFScreenerV3Aa01", "name": "Red-flag screener V3 (watchlist, risk score)", "nodes": nodes, "connections": conn, "settings": {"executionOrder": "v1"}}
json.dump(wf, open('red-flag-screener-v3.n8n.json', 'w', encoding='utf8'), indent=2, ensure_ascii=False)
print('nodes', len(nodes), 'run-checks chars', len(engine + score + runner))
