// Builds a 2-sheet workbook and checks the ZIP/XML structure. Run: node test-writer-v3.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildXlsx } = require('./xlsx-writer-v3');

const buf = buildXlsx([
  { name: 'Ranking', type: 'ranking', rows: [
    { Rank: 1, Ticker: 'IDEA', Company: 'Vodafone Idea', Score: 61.2, Band: 'Very high', Flags: 30, HighFlags: 12, Coverage: 90, Change: 'New', TopFlags: 'A1; B2' },
    { Rank: 2, Ticker: 'IOC', Company: 'Indian Oil', Score: 20, Band: 'Moderate', Flags: 9, HighFlags: 2, Coverage: 95, Change: 'New', TopFlags: 'x' },
    { Rank: 3, Ticker: 'BAD', Company: '', Score: null, Band: 'Unrated', Flags: '', HighFlags: '', Coverage: '', Change: '', TopFlags: 'Could not find financial tables' }] },
  { name: 'IDEA', type: 'detail', rows: [
    { Status: 'SUMMARY', Severity: '', Section: '', Check: 'sum & <co>', Evidence: 'e' },
    { Status: 'FLAG', Severity: 'High', Section: 'A', Check: 'A1. x', Evidence: 'ev' }] },
  { name: 'IDEA', type: 'detail', rows: [{ Status: 'SUMMARY', Severity: '', Section: '', Check: 'dup name', Evidence: '' }] },
]);
const out = path.join(os.tmpdir(), 'rf-v3-test.xlsx');
fs.writeFileSync(out, buf);
assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'starts with a ZIP local header');
const text = buf.toString('latin1');
['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/styles.xml'].forEach((p) => assert(text.includes(p), p));
assert(text.includes('<sheet name="IDEA 2"'), 'duplicate sheet names are made unique');
assert(text.includes('sum &amp; &lt;co&gt;'), 'text is escaped');
assert(text.includes('<c r="D2" s="4"><v>61.2</v></c>') || /<c r="D2" s="\d+"><v>61.2<\/v><\/c>/.test(text), 'numbers are written as numbers');
console.log('writer ok, file:', out);
