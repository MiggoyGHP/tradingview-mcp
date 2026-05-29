/**
 * Offline unit tests for the data-export helpers (no TradingView needed).
 * Covers CSV serialization, tolerant CSV parsing (duplicate-header uniquify +
 * numeric coercion + quoted fields), and writeExport file output.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowsToCSV, csvToRows, writeExport } from '../src/core/export.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '_export_test_out');

after(() => rmSync(TMP, { recursive: true, force: true }));

describe('rowsToCSV', () => {
  it('writes a header and rows in column order', () => {
    const csv = rowsToCSV([{ time: 1, close: 10 }, { time: 2, close: 11 }], ['time', 'close']);
    assert.equal(csv, 'time,close\n1,10\n2,11\n');
  });

  it('quotes and escapes cells containing comma, quote, or newline', () => {
    const csv = rowsToCSV([{ a: 'x,y', b: 'he said "hi"', c: 'line1\nline2' }], ['a', 'b', 'c']);
    assert.equal(csv, 'a,b,c\n"x,y","he said ""hi""","line1\nline2"\n');
  });

  it('infers columns from the first row when not given', () => {
    const csv = rowsToCSV([{ p: 1, q: 2 }]);
    assert.equal(csv.split('\n')[0], 'p,q');
  });
});

describe('csvToRows', () => {
  it('uniquifies duplicate headers (TradingView emits several EMA/Plot columns)', () => {
    const { columns } = csvToRows('time,EMA,EMA,EMA\n1,2,3,4\n');
    assert.deepEqual(columns, ['time', 'EMA', 'EMA_1', 'EMA_2']);
  });

  it('coerces numeric cells to Number and leaves blanks empty', () => {
    const { rows } = csvToRows('time,close,note\n1742391000,168.824,\n');
    assert.equal(rows[0].time, 1742391000);
    assert.equal(typeof rows[0].close, 'number');
    assert.equal(rows[0].close, 168.824);
    assert.equal(rows[0].note, '');
  });

  it('handles scientific notation and negative numbers', () => {
    const { rows } = csvToRows('v\n5.1e7\n-9.46\n');
    assert.equal(rows[0].v, 51000000);
    assert.equal(rows[1].v, -9.46);
  });

  it('respects quoted fields containing commas', () => {
    const { columns, rows } = csvToRows('name,val\n"PlotCandle (High, Low)",3\n');
    assert.deepEqual(columns, ['name', 'val']);
    assert.equal(rows[0].name, 'PlotCandle (High, Low)');
    assert.equal(rows[0].val, 3);
  });

  it('round-trips with rowsToCSV', () => {
    const rows = [{ time: 1, close: 10.5 }, { time: 2, close: 11 }];
    const back = csvToRows(rowsToCSV(rows, ['time', 'close'])).rows;
    assert.deepEqual(back, rows);
  });
});

describe('writeExport', () => {
  it('writes JSON + CSV with timestamped names and returns absolute paths', () => {
    const rows = [{ time: 1, close: 10 }, { time: 2, close: 11 }];
    const res = writeExport({ base: 'AAPL_1D', rows, columns: ['time', 'close'], out_dir: TMP });
    assert.equal(res.row_count, 2);
    assert.ok(res.json_path.endsWith('.json'));
    assert.ok(res.csv_path.endsWith('.csv'));
    assert.ok(existsSync(res.json_path));
    assert.ok(existsSync(res.csv_path));
    assert.deepEqual(JSON.parse(readFileSync(res.json_path, 'utf8')), rows);
    assert.equal(readFileSync(res.csv_path, 'utf8'), 'time,close\n1,10\n2,11\n');
    assert.match(res.csv_path, /AAPL_1D_/);
  });

  it('honors the formats filter', () => {
    const res = writeExport({ base: 'x', rows: [{ a: 1 }], formats: ['json'], out_dir: TMP });
    assert.ok(res.json_path);
    assert.equal(res.csv_path, undefined);
  });
});
