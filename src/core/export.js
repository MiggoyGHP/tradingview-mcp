/**
 * Core historical-data export logic.
 *
 * Primary engine: drive TradingView's native "Download chart data…" menu, which
 * writes a CSV containing time + OHLCV + EVERY visible indicator's full per-bar
 * history (UNIX timestamps). We capture the download over CDP by redirecting the
 * browser download path and watching Browser.downloadProgress. This is the only
 * reliable source of historical indicator series (no other tool exposes it).
 *
 * Fallback engine ("api"): the existing getOhlcv() direct-bars path — fast, no UI,
 * but price-only (no indicator columns).
 *
 * Output: timestamped JSON + CSV files in data_exports/ (or a caller-supplied dir),
 * mirroring the screenshots/ convention in core/capture.js.
 */
import { getClient, evaluate } from '../connection.js';
import { getOhlcv, getPineTables } from './data.js';
import { setSource, smartCompile } from './pine.js';
import { setSymbol, setTimeframe, manageIndicator, getState } from './chart.js';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const EXPORT_DIR = join(dirname(dirname(__dirname)), 'data_exports');

const DOWNLOAD_TIMEOUT_MS = Number(process.env.TV_MCP_EXPORT_TIMEOUT_MS || 25000);

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-'); // 2026-05-29T14-02-10-123Z
}
function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}

// ---------------------------------------------------------------------------
// CSV serialization (hand-rolled — no dependency)
// ---------------------------------------------------------------------------
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Convert an array of row objects to a CSV string. */
export function rowsToCSV(rows, columns) {
  const cols = columns || (rows && rows.length ? Object.keys(rows[0]) : []);
  const lines = [cols.map(csvCell).join(',')];
  for (const r of rows || []) lines.push(cols.map(c => csvCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

/** Split CSV text into records (array of arrays), honoring quoted fields. */
function parseCSVRecords(text) {
  const records = [];
  let field = '', record = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field); field = '';
    } else if (ch === '\n') {
      record.push(field); records.push(record); record = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) { record.push(field); records.push(record); }
  return records;
}

/**
 * Parse CSV text to { columns, rows }. Uniquifies duplicate headers (TradingView
 * emits several "EMA"/"Plot"/"Shapes" columns) and coerces numeric cells to Number
 * so the JSON is dashboard-ready.
 */
export function csvToRows(text) {
  const records = parseCSVRecords(text);
  if (records.length === 0) return { columns: [], rows: [] };
  const seen = {};
  const columns = records[0].map(h => {
    let name = (h || '').trim() || 'col';
    if (seen[name] != null) { seen[name] += 1; name = `${name}_${seen[name]}`; }
    else seen[name] = 0;
    return name;
  });
  const numRe = /^-?\d*\.?\d+(e[-+]?\d+)?$/i;
  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.length === 1 && rec[0] === '') continue; // trailing blank line
    const obj = {};
    for (let c = 0; c < columns.length; c++) {
      let val = rec[c] === undefined ? '' : rec[c];
      if (val !== '' && numRe.test(val.trim())) val = Number(val);
      obj[columns[c]] = val;
    }
    rows.push(obj);
  }
  return { columns, rows };
}

/**
 * Write rows to timestamped JSON and/or CSV files.
 * @returns {{ json_path?: string, csv_path?: string, row_count: number }}
 */
export function writeExport({ base, rows, columns, formats = ['json', 'csv'], out_dir } = {}) {
  const dir = out_dir || EXPORT_DIR;
  mkdirSync(dir, { recursive: true });
  const fname = `${sanitize(base)}_${stamp()}`;
  const result = { row_count: rows ? rows.length : 0 };
  if (formats.includes('json')) {
    const p = join(dir, `${fname}.json`);
    writeFileSync(p, JSON.stringify(rows || []));
    result.json_path = p;
  }
  if (formats.includes('csv')) {
    const p = join(dir, `${fname}.csv`);
    writeFileSync(p, rowsToCSV(rows, columns));
    result.csv_path = p;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Native "Download chart data…" UI driver (runs inside the page over CDP)
// ---------------------------------------------------------------------------
const DRIVE_JS = `
(async function(){
  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
  function fire(el){
    if(!el) return false;
    ['pointerdown','mousedown','mouseup','click'].forEach(function(type){
      el.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window}));
    });
    return true;
  }
  var steps=[];
  var menuBtn=document.querySelector('[data-name="save-load-menu"]');
  steps.push('menuBtn:'+!!menuBtn); fire(menuBtn); await sleep(700);
  var row=null;
  document.querySelectorAll('.menu-Uy_he976 [role="row"], [class*="menuBox"] [role="row"], [role="menuitem"]').forEach(function(el){
    if(!row && /download chart data/i.test((el.textContent||''))) row=el;
  });
  steps.push('row:'+!!row); fire(row); await sleep(900);
  var dlg=null, cands=document.querySelectorAll('[role="dialog"],[class*="dialog"]');
  for(var i=0;i<cands.length;i++){ if(/download chart data|time format/i.test(cands[i].textContent||'')){dlg=cands[i];break;} }
  steps.push('dialog:'+!!dlg);
  if(dlg){
    var unix=null;
    dlg.querySelectorAll('*').forEach(function(el){
      if(!unix && el.children.length===0 && /unix timestamp/i.test(el.textContent||'')) unix=el;
    });
    if(unix){ fire(unix); steps.push('unix-toggled'); await sleep(300); }
    var dlBtn=null;
    dlg.querySelectorAll('button').forEach(function(b){ if(/^download$/i.test((b.textContent||'').trim())) dlBtn=b; });
    steps.push('downloadBtn:'+!!dlBtn);
    fire(dlBtn);
  }
  return steps.join(' | ');
})()
`;

async function exportViaNative({ dir, formats }) {
  const client = await getClient();
  const tmpDir = join(dir, '_tmp_dl');
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  let willBegin = null, completed = false, canceled = false;
  const onBegin = (p) => { willBegin = willBegin || p; };
  const onProgress = (p) => {
    if (p.state === 'completed') completed = true;
    if (p.state === 'canceled') canceled = true;
  };
  client.on('Browser.downloadWillBegin', onBegin);
  client.on('Browser.downloadProgress', onProgress);

  try {
    try {
      await client.Browser.setDownloadBehavior({ behavior: 'allow', downloadPath: tmpDir, eventsEnabled: true });
    } catch (e1) {
      // Older/locked-down builds: fall back to the deprecated per-page command.
      await client.Page.setDownloadBehavior({ behavior: 'allow', downloadPath: tmpDir });
    }

    const drive = await client.Runtime.evaluate({ expression: DRIVE_JS, awaitPromise: true, returnByValue: true });
    const steps = drive.result?.value || drive.exceptionDetails?.text || '';
    if (/row:false|dialog:false|downloadBtn:false/.test(steps)) {
      throw new Error(`Export UI flow failed (${steps}). The "Download chart data" menu path may have changed.`);
    }

    const start = Date.now();
    while (Date.now() - start < DOWNLOAD_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, 400));
      if (completed) break;
      if (canceled) throw new Error('TradingView canceled the download');
      const ready = readdirSync(tmpDir).filter(f => !f.endsWith('.crdownload'));
      if (ready.length && willBegin) break;
    }
    const files = readdirSync(tmpDir).filter(f => !f.endsWith('.crdownload'));
    if (!files.length) throw new Error('Download did not complete within timeout');

    const srcName = files[0];
    const srcPath = join(tmpDir, srcName);
    const csvText = readFileSync(srcPath, 'utf8');
    const parsed = csvToRows(csvText);
    const base = sanitize(srcName.replace(/\.csv$/i, ''));
    const fname = `${base}_${stamp()}`;

    const result = {
      success: true,
      engine: 'native',
      source_filename: srcName,
      columns: parsed.columns,
      row_count: parsed.rows.length,
    };
    if (parsed.rows.length) {
      result.first_time = parsed.rows[0].time;
      result.last_time = parsed.rows[parsed.rows.length - 1].time;
    }
    if (formats.includes('csv')) {
      const csvPath = join(dir, `${fname}.csv`);
      renameSync(srcPath, csvPath);
      result.csv_path = csvPath;
    }
    if (formats.includes('json')) {
      const jsonPath = join(dir, `${fname}.json`);
      writeFileSync(jsonPath, JSON.stringify(parsed.rows));
      result.json_path = jsonPath;
    }
    return result;
  } finally {
    client.removeListener('Browser.downloadWillBegin', onBegin);
    client.removeListener('Browser.downloadProgress', onProgress);
    rmSync(tmpDir, { recursive: true, force: true });
    // Restore default download behavior so we don't silently capture the user's own downloads.
    try { await client.Browser.setDownloadBehavior({ behavior: 'default' }); } catch {}
  }
}

async function exportViaApi({ symbol, count, dir, formats }) {
  const data = await getOhlcv({ count: count || 500, symbol });
  const rows = (data.bars || []).map(b => ({
    time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  }));
  const columns = ['time', 'open', 'high', 'low', 'close', 'volume'];
  const base = `${symbol || 'chart'}_ohlcv`;
  const w = writeExport({ base, rows, columns, formats, out_dir: dir });
  return {
    success: true,
    engine: 'api',
    note: 'price only (no indicator columns) — native export gives OHLCV + all visible indicators',
    columns,
    row_count: w.row_count,
    csv_path: w.csv_path,
    json_path: w.json_path,
    first_time: rows.length ? rows[0].time : null,
    last_time: rows.length ? rows[rows.length - 1].time : null,
  };
}

/**
 * Export historical chart data (OHLCV + visible indicators) to files.
 *
 * @param {object} opts
 * @param {string} [opts.symbol]      Switch to this symbol first (e.g. "NASDAQ:AAPL").
 * @param {string} [opts.timeframe]   Switch to this resolution first (e.g. "D", "60").
 * @param {string[]} [opts.indicators] Full indicator names to add before export
 *                                     (e.g. "Relative Strength Index"). They must be
 *                                     ON the chart for their columns to appear.
 * @param {number} [opts.count]        Bar count for the API fallback (max 500).
 * @param {('native'|'api')} [opts.engine='native']
 * @param {string} [opts.out_dir]     Output directory (default data_exports/).
 * @param {string[]} [opts.formats=['json','csv']]
 */
export async function exportChartData({
  symbol, timeframe, indicators, count, engine = 'native', out_dir, formats = ['json', 'csv'],
} = {}) {
  const dir = out_dir || EXPORT_DIR;
  mkdirSync(dir, { recursive: true });

  if (symbol) await setSymbol({ symbol });
  if (timeframe) await setTimeframe({ timeframe });

  const indicatorsAdded = [];
  const indicatorsFailed = [];
  if (Array.isArray(indicators) && indicators.length) {
    for (const ind of indicators) {
      try {
        const r = await manageIndicator({ action: 'add', indicator: ind });
        if (r.success) indicatorsAdded.push(ind);
        else indicatorsFailed.push(ind);
      } catch {
        indicatorsFailed.push(ind);
      }
    }
    // Give freshly-added studies time to compute before the chart serializes them.
    if (indicatorsAdded.length) await new Promise(r => setTimeout(r, 1500));
  }

  let result;
  if (engine === 'api') {
    result = await exportViaApi({ symbol, count, dir, formats });
  } else {
    try {
      result = await exportViaNative({ dir, formats });
    } catch (err) {
      // Auto-fallback to the price-only API path so the caller still gets data.
      result = await exportViaApi({ symbol, count, dir, formats });
      result.fallback_from = 'native';
      result.fallback_reason = err.message;
    }
  }

  if (symbol) result.symbol = symbol;
  if (timeframe) result.timeframe = timeframe;
  if (indicatorsAdded.length) result.indicators_added = indicatorsAdded;
  if (indicatorsFailed.length) result.indicators_failed = indicatorsFailed;
  return result;
}

// ---------------------------------------------------------------------------
// Fundamentals export (multi-quarter history via Pine request.financial)
// ---------------------------------------------------------------------------
const METRIC_ALIASES = {
  revenue: 'TOTAL_REVENUE', total_revenue: 'TOTAL_REVENUE', sales: 'TOTAL_REVENUE',
  net_income: 'NET_INCOME', ni: 'NET_INCOME', earnings: 'NET_INCOME',
  fcf: 'FREE_CASH_FLOW', free_cash_flow: 'FREE_CASH_FLOW',
  gross_profit: 'GROSS_PROFIT', ebitda: 'EBITDA',
  eps: 'EARNINGS_PER_SHARE_DILUTED', eps_diluted: 'EARNINGS_PER_SHARE_DILUTED',
};
function normalizeMetric(m) {
  const k = String(m).toLowerCase().replace(/\s+/g, '_');
  return METRIC_ALIASES[k] || String(m).toUpperCase();
}

/**
 * Generate a Pine v6 indicator that reads the last N quarterly values for each
 * (symbol, metric) pair via request.financial() and renders them into a table for
 * read-back. Uses the proven direct series-indexing pattern (series[N-1-q]) from
 * the quarterly-history skill — array accumulation triggered a Pine "error in
 * series" runtime fault. Emits "na" (never empty) for missing cells so
 * getPineTables' Boolean filter does not collapse columns. All statements are
 * single-line per the v6 gotchas (newlines terminate statements).
 */
function buildFundamentalsPine(pairs, N) {
  const L = [];
  L.push('//@version=6');
  L.push('indicator("Fundamentals Export", overlay=false, max_bars_back=5000)');
  pairs.forEach((p, i) => L.push(`f${i} = request.financial(${JSON.stringify(p.symbol)}, ${JSON.stringify(p.metric)}, "FQ")`));
  const cols = N + 1;
  const rows = pairs.length + 1;
  L.push(`var table t = table.new(position.top_right, ${cols}, ${rows}, border_width=1, border_color=color.gray, bgcolor=color.new(color.black, 85))`);
  L.push('if barstate.islastconfirmedhistory');
  L.push('    table.cell(t, 0, 0, "key", text_color=color.white, text_size=size.tiny)');
  for (let q = 0; q < N; q++) {
    L.push(`    table.cell(t, ${q + 1}, 0, "Q-${N - 1 - q}", text_color=color.white, text_size=size.tiny)`);
  }
  pairs.forEach((p, i) => {
    const r = i + 1;
    L.push(`    table.cell(t, 0, ${r}, ${JSON.stringify(`${p.symbol}::${p.metric}`)}, text_color=color.white, text_size=size.tiny)`);
    for (let q = 0; q < N; q++) {
      const back = N - 1 - q;
      L.push(`    table.cell(t, ${q + 1}, ${r}, na(f${i}[${back}]) ? "na" : str.tostring(f${i}[${back}]), text_color=color.white, text_size=size.tiny)`);
    }
  });
  return L.join('\n');
}

// Click the Pine Editor's "Add to chart" button via DOM dispatch. Programmatic
// Monaco setValue() does not always mark the editor dirty, so pine_smart_compile
// can fall back to the save icon and never add the study — this explicit click is
// the reliable path observed live.
async function clickAddToChart() {
  return evaluate(`
    (function(){
      var btn=null;
      var els=document.querySelectorAll('button');
      for (var i=0;i<els.length;i++){
        var b=els[i];
        if (b.offsetParent!==null && /^(Save and add to chart|Add to chart)/i.test((b.textContent||'').trim())){ btn=b; break; }
      }
      if(!btn) return false;
      ['pointerdown','mousedown','mouseup','click'].forEach(function(t){ btn.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})); });
      return true;
    })()
  `);
}

const isPineError = (e) => e && (e.severity === 8 || e.severity === 'error');

// Compile the current Pine source and make sure the named study actually lands on
// the chart, recovering from pine_smart_compile clicking the wrong button.
async function ensureStudyOnChart(studyName, attempts = 3) {
  const present = async () => {
    const st = await getState().catch(() => ({ studies: [] }));
    return (st.studies || []).some(s => (s.name || '').toLowerCase().includes(studyName.toLowerCase()));
  };
  let lastErrors = null;
  for (let i = 0; i < attempts; i++) {
    const c = await smartCompile();
    const realErrors = (c.errors || []).filter(isPineError);
    if (realErrors.length) { lastErrors = realErrors; throw new Error(`Pine compile failed: ${JSON.stringify(realErrors)}`); }
    await new Promise(r => setTimeout(r, 1200));
    if (await present()) return;
    // smartCompile likely clicked the save icon instead of "Add to chart" — do it explicitly.
    await clickAddToChart();
    await new Promise(r => setTimeout(r, 2000));
    if (await present()) return;
  }
  throw new Error(`Pine indicator "${studyName}" did not attach to the chart after ${attempts} attempts (smartCompile add-to-chart flakiness). Ensure the Pine Editor is open with no unsaved script, then re-run.${lastErrors ? ' Errors: ' + JSON.stringify(lastErrors) : ''}`);
}

/**
 * Export multi-quarter fundamentals (revenue, net income, FCF, …) to JSON + CSV.
 * Long-form rows {symbol, metric, period, value} — the dashboard-friendly shape.
 *
 * @param {object} opts
 * @param {string[]} opts.symbols   Symbols WITH exchange (e.g. ["NASDAQ:NOW","NYSE:CRM"]).
 * @param {string[]} [opts.metrics] Friendly names or Pine keys (default revenue/net_income/fcf).
 * @param {number} [opts.quarters=6]
 * @param {string} [opts.out_dir]
 * @param {string[]} [opts.formats=['json','csv']]
 */
export async function exportFundamentals({ symbols, metrics, quarters = 6, out_dir, formats = ['json', 'csv'] } = {}) {
  if (!Array.isArray(symbols) || !symbols.length) throw new Error('symbols (array, with exchange prefix e.g. "NASDAQ:NOW") is required');
  const N = Math.min(Math.max(Number(quarters) || 6, 1), 12);
  const metricKeys = (metrics && metrics.length ? metrics : ['revenue', 'net_income', 'fcf']).map(normalizeMetric);
  const pairs = [];
  for (const s of symbols) for (const m of metricKeys) pairs.push({ symbol: s, metric: m });

  await setSource({ source: buildFundamentalsPine(pairs, N) });
  await ensureStudyOnChart('Fundamentals Export');

  // request.financial resolves asynchronously — barstate.islast (table render) fires late.
  const tablesRes = await getPineTables({ study_filter: 'Fundamentals Export', retries: 6, retry_delay_ms: 4000 });
  const study = (tablesRes.studies || []).find(s => /Fundamentals Export/i.test(s.name)) || (tablesRes.studies || [])[0];
  if (!study || !study.tables || !study.tables.length) {
    throw new Error('No table output from Pine — request.financial may still be resolving. Re-run, or verify the symbols have an exchange prefix.');
  }

  const rawRows = study.tables[0].rows || [];
  let periods = [];
  const longRows = [];
  for (const rowStr of rawRows) {
    const cells = rowStr.split(' | ');
    if (cells[0] === 'key') { periods = cells.slice(1); continue; }
    const sep = cells[0].indexOf('::');
    const symbol = sep >= 0 ? cells[0].slice(0, sep) : cells[0];
    const metric = sep >= 0 ? cells[0].slice(sep + 2) : '';
    const vals = cells.slice(1);
    for (let q = 0; q < vals.length; q++) {
      const raw = vals[q];
      longRows.push({
        symbol,
        metric,
        period: periods[q] || `Q-${vals.length - 1 - q}`,
        value: (raw === 'na' || raw === undefined || raw === '') ? null : Number(raw),
      });
    }
  }

  const base = symbols.length === 1 ? `${symbols[0]}_fundamentals` : `fundamentals_${symbols.length}sym`;
  const w = writeExport({ base, rows: longRows, columns: ['symbol', 'metric', 'period', 'value'], formats, out_dir });
  return {
    success: true,
    source: 'pine_request_financial',
    symbols,
    metrics: metricKeys,
    quarters: N,
    note: 'values are as-reported (e.g. USD); long-form rows {symbol, metric, period, value}',
    row_count: w.row_count,
    csv_path: w.csv_path,
    json_path: w.json_path,
  };
}
