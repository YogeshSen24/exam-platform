import { describe, it, expect } from 'vitest';
import { parseCsv } from '../lib/csv';
describe('CSV uploads', () => {
  it('preserves quoted commas, escaped quotes, multiline cells and a byte-order mark', () => {
    expect(parseCsv('\uFEFFid,name,notes\r\n1,"Doe, Jane","line one\nline ""two"""')).toEqual([{ id: '1', name: 'Doe, Jane', notes: 'line one\nline "two"' }]);
  });
  it('rejects malformed and ambiguous rows', () => {
    expect(() => parseCsv('id,id\n1,2')).toThrow();
    expect(() => parseCsv('id,name\n1')).toThrow();
    expect(() => parseCsv('id,name\n1,"unfinished')).toThrow();
  });
});
