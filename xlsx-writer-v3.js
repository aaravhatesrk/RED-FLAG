// V3: multi-sheet variant of xlsx-writer.js. Same hand-built OOXML, but each sheet brings its own columns.
// Builds the OOXML parts by hand and packs them into a ZIP using stored (uncompressed) entries.
const DETAIL_COLUMNS = [
  { key: 'Status', title: 'Status', min: 11, max: 13 },
  { key: 'Severity', title: 'Severity', min: 10, max: 12 },
  { key: 'Section', title: 'Section', min: 14, max: 34 },
  { key: 'Check', title: 'Check', min: 30, max: 58 },
  { key: 'Evidence', title: 'Evidence', min: 30, max: 80 },
];
const RANKING_COLUMNS = [
  { key: 'Rank', title: 'Rank', min: 6, max: 8 },
  { key: 'Ticker', title: 'Ticker', min: 10, max: 16 },
  { key: 'Company', title: 'Company', min: 18, max: 34 },
  { key: 'Score', title: 'Risk score (0-100)', min: 12, max: 14 },
  { key: 'Band', title: 'Band', min: 11, max: 13 },
  { key: 'Flags', title: 'Flags', min: 7, max: 9 },
  { key: 'HighFlags', title: 'High-severity flags', min: 12, max: 14 },
  { key: 'Coverage', title: 'Checks tested %', min: 12, max: 14 },
  { key: 'Change', title: 'Change vs last run', min: 16, max: 20 },
  { key: 'TopFlags', title: 'Top flagged checks', min: 40, max: 90 },
];
const LINE_HEIGHT = 15;

// cellXfs index per row kind: [normal cell, status cell]
const STYLE = { header: 1, summary: 2, FLAG: [3, 4], OK: [5, 6], 'Not tested': [7, 8], AMBER: [9, 10] };

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="6">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FF9C0006"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FF006100"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FF595959"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="8">' +
  '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right>' +
  '<top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="11">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colWidths(rows, COLUMNS) {
  return COLUMNS.map((c) => {
    const longest = rows.filter((r) => r.Status !== 'SUMMARY').reduce((m, r) => Math.max(m, String(r[c.key] == null ? '' : r[c.key]).length), c.title.length);
    return Math.max(c.min, Math.min(c.max, longest + 2));
  });
}

// kindOf(row) picks the colour family: FLAG, OK, 'Not tested', AMBER or SUMMARY.
function sheetXml(rows, COLUMNS, kindOf) {
  const widths = colWidths(rows, COLUMNS);
  const letters = 'ABCDEFGHIJKL';
  const cell = (ci, ri, val, style) =>
    typeof val === 'number' && Number.isFinite(val)
      ? '<c r="' + letters[ci] + ri + '" s="' + style + '"><v>' + val + '</v></c>'
      : '<c r="' + letters[ci] + ri + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + esc(val) + '</t></is></c>';
  const rowXml = (ri, cells, lines) =>
    '<row r="' + ri + '" ht="' + Math.max(1, lines) * LINE_HEIGHT + '" customHeight="1">' + cells.join('') + '</row>';
  const linesFor = (r) => COLUMNS.reduce((m, c, i) => Math.max(m, Math.ceil(String(r[c.key] == null ? '' : r[c.key]).length / (widths[i] - 1))), 1);

  const out = [rowXml(1, COLUMNS.map((c, i) => cell(i, 1, c.title, STYLE.header)), 2)];
  rows.forEach((r, idx) => {
    const ri = idx + 2;
    const kind = kindOf(r);
    const isSummary = kind === 'SUMMARY';
    const pair = STYLE[kind];
    const cells = COLUMNS.map((c, i) => cell(i, ri, r[c.key], isSummary ? STYLE.summary : (i === 0 ? pair[1] : pair[0])));
    out.push(rowXml(ri, cells, linesFor(r)));
  });
  const lastRow = rows.length + 1;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' +
    '<sheetData>' + out.join('') + '</sheetData>' +
    '<autoFilter ref="A1:' + letters[COLUMNS.length - 1] + lastRow + '"/>' +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
    '</worksheet>';
}

const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStored(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  files.forEach((f) => {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

const SHEET_KIND = {
  detail: (r) => (r.Status === 'SUMMARY' ? 'SUMMARY' : r.Status),
  ranking: (r) => ({ Low: 'OK', Moderate: 'AMBER', High: 'FLAG', 'Very high': 'FLAG' }[r.Band] || 'Not tested'),
};
const safeSheetName = (name, used) => {
  const base = String(name).replace(/[\[\]:*?\/\\]/g, '').slice(0, 31) || 'Sheet';
  let out = base, k = 2;
  while (used.has(out.toLowerCase())) out = base.slice(0, 28) + ' ' + k++;
  used.add(out.toLowerCase());
  return out;
};

// sheets: [{ name, type: 'ranking' | 'detail', rows }]. Ranking rows use RANKING_COLUMNS keys; detail rows are check rows with a SUMMARY row first.
function buildXlsx(sheets) {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const used = new Set();
  const named = sheets.map((sh) => Object.assign({}, sh, { name: safeSheetName(sh.name, used) }));
  const n = (i) => i + 1;
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  return zipStored([
    { name: '[Content_Types].xml', data: xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="' + ct + 'sheet.main+xml"/>' + named.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + n(i) + '.xml" ContentType="' + ct + 'worksheet+xml"/>').join('') + '<Override PartName="/xl/styles.xml" ContentType="' + ct + 'styles+xml"/></Types>' },
    { name: '_rels/.rels', data: xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + rel + 'officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: xml + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + rel.slice(0, -1) + '"><sheets>' + named.map((sh, i) => '<sheet name="' + esc(sh.name) + '" sheetId="' + n(i) + '" r:id="rId' + n(i) + '"/>').join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + named.map((_, i) => '<Relationship Id="rId' + n(i) + '" Type="' + rel + 'worksheet" Target="worksheets/sheet' + n(i) + '.xml"/>').join('') + '<Relationship Id="rId' + (named.length + 1) + '" Type="' + rel + 'styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: STYLES_XML },
  ].concat(named.map((sh, i) => ({
    name: 'xl/worksheets/sheet' + n(i) + '.xml',
    data: sheetXml(sh.rows, sh.type === 'ranking' ? RANKING_COLUMNS : DETAIL_COLUMNS, SHEET_KIND[sh.type]),
  }))));
}

if (typeof module !== 'undefined') module.exports = { buildXlsx };
