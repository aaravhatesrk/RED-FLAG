import json, re
engine = open('engine.js', encoding='utf8').read()
engine = engine.split("if (typeof module")[0]
writer = open('xlsx-writer.js', encoding='utf8').read().split("if (typeof module")[0]

runner = """
const html = String($('Fetch screener page').first().json.data || '');
const meta = $('Parse ticker').first().json;
// Extra sources: a failed or blocked call leaves that source null, so its checks show "Not tested".
const grab = (name) => { try { const d = $(name).first().json.data; return typeof d === 'string' ? d : null; } catch (e) { return null; } };
const out = runChecks(html, { pe: grab('Fetch P/E history'), price: grab('Fetch price history'), peers: grab('Fetch peers'), pledge: grab('Fetch promoter pledge') });
if (out.error) {
  return [{ json: { error: out.error + ' (ticker: ' + meta.ticker + ', ' + meta.mode + ')' + (meta.mode === 'consolidated' && out.error.startsWith('Could not find') ? ' If the company has no consolidated accounts, retry with Standalone.' : '') } }];
}
const count = { FLAG: 0, OK: 0, 'Not tested': 0 };
out.rows.forEach((r) => { count[r.Status] += 1; });
const summary = {
  Status: 'SUMMARY', Severity: '', Section: '',
  Check: out.company + ', latest year ' + out.latestYear + ': ' + count.FLAG + ' flagged, ' + count.OK + ' OK, ' + count['Not tested'] + ' not tested of ' + out.rows.length + ' checks',
  Evidence: 'A flag means look closer, not that the company is bad. Source: screener.in. Not investment advice.',
};
return [summary].concat(out.rows).map((r) => ({ json: r }));
"""

excel = """
const rows = $input.all().map((i) => i.json);
const ticker = $('Parse ticker').first().json.ticker;
const buf = buildXlsx(rows);
const fileName = 'red-flag-screen-' + ticker + '.xlsx';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
return [{ json: { fileName }, binary: { data: await this.helpers.prepareBinaryData(buf, fileName, mime) } }];
"""

parse = """
const raw = String($input.first().json['Ticker'] || '').toUpperCase().trim();
const ticker = raw.replace(/[^A-Z0-9&-]/g, '');
const mode = String($input.first().json['Statements'] || '').toLowerCase().startsWith('standalone') ? 'standalone' : 'consolidated';
return [{ json: { ticker, mode } }];
"""

def n(name, typ, ver, params, pos, **kw):
    d = {"parameters": params, "id": kw.pop("id"), "name": name, "type": typ, "typeVersion": ver, "position": pos}
    d.update(kw)
    return d


prep = """
const html = String($input.first().json.data || '');
const meta = $('Parse ticker').first().json;
const cid = (html.match(/data-company-id="(\d+)"/) || [])[1] || '';
const wid = (html.match(/data-warehouse-id="(\d+)"/) || [])[1] || '';
return [{ json: { cid, wid, ticker: meta.ticker, consolidated: meta.mode === 'consolidated' } }];
"""

def api(name, url, pos, nid, extra_headers=None):
    # NSE rejects requests without an Accept header (403 Access Denied).
    hdrs = [{"name": "User-Agent", "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}, {"name": "Accept", "value": "*/*"}] + (extra_headers or [])
    return n(name, "n8n-nodes-base.httpRequest", 4.2, {
        "url": url, "sendHeaders": True, "headerParameters": {"parameters": hdrs},
        "options": {"response": {"response": {"neverError": True, "responseFormat": "text"}}, "timeout": 20000}},
        pos, id=nid, onError="continueRegularOutput")

AJAX = [{"name": "X-Requested-With", "value": "XMLHttpRequest"}]
SCR = "=https://www.screener.in/api/company/"

nodes = [
 n("Ticker form", "n8n-nodes-base.formTrigger", 2.2, {
   "formTitle": "Red-flag screener (V2)",
   "formDescription": "Enter an NSE/BSE symbol of a non-financial Indian company (for example IOC or RELIANCE). The workflow pulls 12 years of statements, 12 quarters and the shareholding pattern from screener.in and runs 61 checks on earnings quality, cash flow, working capital, leverage, returns, margins, ownership, valuation and the latest quarter. Extra sources (screener peers and price APIs, NSE pledge data) are optional: if one is unavailable its checks show Not tested.",
   "formFields": {"values": [
     {"fieldLabel": "Ticker", "placeholder": "IOC", "requiredField": True},
     {"fieldLabel": "Statements", "fieldType": "dropdown", "fieldOptions": {"values": [{"option": "Consolidated"}, {"option": "Standalone"}]}, "requiredField": False}]},
   "options": {}}, [0, 0], id="rf-0001", webhookId="c2d4e6f8-0001-4a00-8000-0000000000aa"),
 n("Parse ticker", "n8n-nodes-base.code", 2, {"jsCode": parse.strip()}, [220, 0], id="rf-0002"),
 n("Fetch screener page", "n8n-nodes-base.httpRequest", 4.2, {
   "url": "=https://www.screener.in/company/{{ encodeURIComponent($json.ticker) }}/{{ $json.mode === 'consolidated' ? 'consolidated/' : '' }}",
   "sendHeaders": True,
   "headerParameters": {"parameters": [{"name": "User-Agent", "value": "Mozilla/5.0"}]},
   "options": {"response": {"response": {"neverError": True, "responseFormat": "text"}}, "timeout": 30000}},
   [440, 0], id="rf-0003"),
 n("Prepare extras", "n8n-nodes-base.code", 2, {"jsCode": prep.strip()}, [660, 0], id="rf-0009"),
 api("Fetch P/E history", SCR + "{{ $('Prepare extras').first().json.cid }}/chart/?q=Price+to+Earning-Median+PE-EPS&days=1825&consolidated={{ $('Prepare extras').first().json.consolidated }}", [880, 0], "rf-0010", AJAX),
 api("Fetch price history", SCR + "{{ $('Prepare extras').first().json.cid }}/chart/?q=Price&days=365&consolidated={{ $('Prepare extras').first().json.consolidated }}", [1100, 0], "rf-0011", AJAX),
 api("Fetch peers", SCR + "{{ $('Prepare extras').first().json.wid }}/peers/", [1320, 0], "rf-0012", AJAX),
 api("Fetch promoter pledge", "=https://www.nseindia.com/api/corporate-pledgedata?index=equities&symbol={{ encodeURIComponent($('Prepare extras').first().json.ticker) }}", [1540, 0], "rf-0013", [{"name": "Referer", "value": "https://www.nseindia.com/"}]),
 n("Run checks", "n8n-nodes-base.code", 2, {"jsCode": (engine + runner).strip()}, [1760, 0], id="rf-0004"),
 n("Failed?", "n8n-nodes-base.if", 2, {
   "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
     "conditions": [{"id": "c1", "leftValue": "={{ $json.error }}", "rightValue": "", "operator": {"type": "string", "operation": "notEmpty", "singleValue": True}}],
     "combinator": "and"}, "options": {}}, [1980, 0], id="rf-0005"),
 n("Show error", "n8n-nodes-base.form", 1, {
   "operation": "completion", "completionTitle": "Could not screen this company",
   "completionMessage": "={{ $json.error }}", "options": {}}, [2200, -120], id="rf-0006", webhookId="c2d4e6f8-0006-4a00-8000-0000000000bb"),
 n("Make Excel file", "n8n-nodes-base.code", 2, {"jsCode": (writer + excel).strip()}, [2200, 120], id="rf-0007"),
 n("Download Excel", "n8n-nodes-base.form", 1, {
   "operation": "completion", "completionTitle": "Your red-flag screen is ready",
   "respondWith": "returnBinary", "inputDataFieldName": "data", "options": {}}, [2420, 120], id="rf-0008", webhookId="c2d4e6f8-0008-4a00-8000-0000000000cc"),
]
conn = {
 "Ticker form": {"main": [[{"node": "Parse ticker", "type": "main", "index": 0}]]},
 "Parse ticker": {"main": [[{"node": "Fetch screener page", "type": "main", "index": 0}]]},
 "Fetch screener page": {"main": [[{"node": "Prepare extras", "type": "main", "index": 0}]]},
 "Prepare extras": {"main": [[{"node": "Fetch P/E history", "type": "main", "index": 0}]]},
 "Fetch P/E history": {"main": [[{"node": "Fetch price history", "type": "main", "index": 0}]]},
 "Fetch price history": {"main": [[{"node": "Fetch peers", "type": "main", "index": 0}]]},
 "Fetch peers": {"main": [[{"node": "Fetch promoter pledge", "type": "main", "index": 0}]]},
 "Fetch promoter pledge": {"main": [[{"node": "Run checks", "type": "main", "index": 0}]]},
 "Run checks": {"main": [[{"node": "Failed?", "type": "main", "index": 0}]]},
 "Failed?": {"main": [[{"node": "Show error", "type": "main", "index": 0}], [{"node": "Make Excel file", "type": "main", "index": 0}]]},
 "Make Excel file": {"main": [[{"node": "Download Excel", "type": "main", "index": 0}]]},
}
wf = {"name": "Red-flag screener V2 (screener.in to Excel)", "nodes": nodes, "connections": conn, "settings": {"executionOrder": "v1"}}
json.dump(wf, open('red-flag-screener-v2.n8n.json', 'w', encoding='utf8'), indent=2, ensure_ascii=False)
print('nodes', len(nodes), 'code chars', len(engine + runner))
