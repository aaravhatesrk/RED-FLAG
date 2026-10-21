import json, re
engine = open('engine.js', encoding='utf8').read()
engine = engine.split("if (typeof module")[0]
writer = open('xlsx-writer.js', encoding='utf8').read().split("if (typeof module")[0]

runner = """
const input = $input.first().json;
const html = typeof input.data === 'string' ? input.data : '';
const meta = $('Parse ticker').first().json;
const out = runChecks(html);
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

nodes = [
 n("Ticker form", "n8n-nodes-base.formTrigger", 2.2, {
   "formTitle": "Red-flag screener (V1)",
   "formDescription": "Enter an NSE/BSE symbol of a non-financial Indian company (for example IOC or RELIANCE). The workflow pulls 12 years of statements from screener.in and runs 44 checks on earnings quality, cash flow, working capital, leverage, returns and margins.",
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
 n("Run checks", "n8n-nodes-base.code", 2, {"jsCode": (engine + runner).strip()}, [660, 0], id="rf-0004"),
 n("Failed?", "n8n-nodes-base.if", 2, {
   "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
     "conditions": [{"id": "c1", "leftValue": "={{ $json.error }}", "rightValue": "", "operator": {"type": "string", "operation": "notEmpty", "singleValue": True}}],
     "combinator": "and"}, "options": {}}, [880, 0], id="rf-0005"),
 n("Show error", "n8n-nodes-base.form", 1, {
   "operation": "completion", "completionTitle": "Could not screen this company",
   "completionMessage": "={{ $json.error }}", "options": {}}, [1100, -120], id="rf-0006", webhookId="c2d4e6f8-0006-4a00-8000-0000000000bb"),
 n("Make Excel file", "n8n-nodes-base.code", 2, {"jsCode": (writer + excel).strip()}, [1100, 120], id="rf-0007"),
 n("Download Excel", "n8n-nodes-base.form", 1, {
   "operation": "completion", "completionTitle": "Your red-flag screen is ready",
   "respondWith": "returnBinary", "inputDataFieldName": "data", "options": {}}, [1320, 120], id="rf-0008", webhookId="c2d4e6f8-0008-4a00-8000-0000000000cc"),
]
conn = {
 "Ticker form": {"main": [[{"node": "Parse ticker", "type": "main", "index": 0}]]},
 "Parse ticker": {"main": [[{"node": "Fetch screener page", "type": "main", "index": 0}]]},
 "Fetch screener page": {"main": [[{"node": "Run checks", "type": "main", "index": 0}]]},
 "Run checks": {"main": [[{"node": "Failed?", "type": "main", "index": 0}]]},
 "Failed?": {"main": [[{"node": "Show error", "type": "main", "index": 0}], [{"node": "Make Excel file", "type": "main", "index": 0}]]},
 "Make Excel file": {"main": [[{"node": "Download Excel", "type": "main", "index": 0}]]},
}
wf = {"name": "Red-flag screener V1 (screener.in to Excel)", "nodes": nodes, "connections": conn, "settings": {"executionOrder": "v1"}}
json.dump(wf, open('red-flag-screener-v1.n8n.json', 'w', encoding='utf8'), indent=2, ensure_ascii=False)
print('nodes', len(nodes), 'code chars', len(engine + runner))
