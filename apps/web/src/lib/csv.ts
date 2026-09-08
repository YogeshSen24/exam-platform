/** Parse quoted CSV, including embedded commas, newlines and escaped quotes. */
export function parseCsv(source: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  const text = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(field); field = '';
      if (char !== ',') { if (row.some(v => v.trim())) rows.push(row); row = []; if (char === '\r' && text[i + 1] === '\n') i++; }
    } else field += char;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted field.');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  const headers = rows.shift()?.map(h => h.trim()) ?? [];
  if (!headers.length || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be present and unique.');
  if (rows.length > 5000) throw new Error('Import at most 5,000 rows at a time.');
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2} has ${values.length} cells; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}
export function downloadFile(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
