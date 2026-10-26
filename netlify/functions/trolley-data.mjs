const SPREADSHEET_ID = '18A-HcjFF4w2ad6__we-JuHBdQ1A58H2VJLLPNyyOQbg';
const MASTER_GID = '1362015650';
const HISTORY_GID = '574953015';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

function csvObjects(text) {
  const rows = parseCsv(text);
  const headers = (rows.shift() || []).map((value) => value.replace(/^\uFEFF/, '').trim());
  return rows.map((values, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, (values[column] || '').trim()])),
  }));
}

function normalizeDate(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  let match = input.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;

  match = input.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input : parsed.toISOString().slice(0, 10);
}

async function fetchSheet(gid) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`);
  url.searchParams.set('tqx', 'out:csv');
  url.searchParams.set('gid', gid);
  url.searchParams.set('_', String(Date.now()));

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
  return csvObjects(await response.text());
}

function asTrolley(record) {
  const row = record.values;
  const id = row['Trolley ID'] || '';
  return {
    id,
    qr: row['QR ID'] || id,
    name: row['Trolley Name'] || id,
    owner: row.Owner || row['Owner / PIC'] || '',
    dept: row.Department || '',
    location: row.Location || row['Current Location'] || row.Line || '',
    frequency: row['Inspection Frequency'] || row.Frequency || '',
    checked: normalizeDate(row['Last Inspection Date'] || row['Inspection Date']),
    due: normalizeDate(row['Next Due Date']),
    outcome: row['Inspection Outcome'] || 'Not inspected',
    verifier: row.Verifier || '',
    action: row['Corrective Action'] || '',
    quarantine: row['Quarantine Status'] || row.Quarantine || 'No',
    releaseStatus: row['Release Status'] || '',
    releaseBy: row['Release By'] || '',
    releaseDate: normalizeDate(row['Release Date']),
    remarks: row.Remarks || '',
    updatedAt: row['Last Updated'] || row['Updated At'] || '',
    sheetRow: record.rowNumber,
  };
}

function asHistory(record) {
  const row = record.values;
  return {
    timestamp: row['Recorded At'] || row.Timestamp || '',
    event: row.Event || 'Inspection',
    trolleyId: row['Trolley ID'] || '',
    name: row['Trolley Name'] || '',
    location: row.Location || '',
    checked: normalizeDate(row['Inspection Date'] || row['Last Inspection Date']),
    due: normalizeDate(row['Next Due Date']),
    outcome: row['Inspection Outcome'] || row.Outcome || '',
    status: row.Status || '',
    verifier: row.Verifier || '',
    correctiveAction: row['Corrective Action'] || '',
    notes: row.Remarks || '',
    sheetRow: record.rowNumber,
  };
}

export default async () => {
  try {
    const [masterRows, historyRows] = await Promise.all([
      fetchSheet(MASTER_GID),
      fetchSheet(HISTORY_GID),
    ]);

    const trolleys = masterRows
      .filter(({ values }) => values['Trolley ID'])
      .map(asTrolley);
    const history = historyRows
      .filter(({ values }) => values['Trolley ID'])
      .map(asHistory);

    return Response.json({
      trolleys,
      history,
      masterLastRow: Math.max(2, ...masterRows.map(({ rowNumber }) => rowNumber)),
      historyLastRow: Math.max(2, ...historyRows.map(({ rowNumber }) => rowNumber)),
      syncedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  } catch {
    return Response.json({ error: 'Could not read the Plant 8 trolley sheets.' }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }
};
