/**
 * Latency & reliability benchmark for the in-process core API.
 * Bypasses MCP/stdio so we measure CDP round-trip overhead only.
 *
 * Run: node scripts/bench.js
 * Requires TradingView running with --remote-debugging-port=9222
 */

import { health, chart, data, capture } from '../src/core/index.js';
import { disconnect } from '../src/connection.js';

const RUNS = 20;
const FAST_RUNS = 50;

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}
function summarize(name, durations, errors) {
  const ok = durations.length;
  const fail = errors.length;
  const mean = ok ? (durations.reduce((a, b) => a + b, 0) / ok).toFixed(1) : 'n/a';
  const min = ok ? Math.min(...durations).toFixed(1) : 'n/a';
  const p50 = ok ? pct(durations, 0.5).toFixed(1) : 'n/a';
  const p95 = ok ? pct(durations, 0.95).toFixed(1) : 'n/a';
  const max = ok ? Math.max(...durations).toFixed(1) : 'n/a';
  return { name, n: ok + fail, ok, fail, min, p50, mean, p95, max, errors: errors.slice(0, 3) };
}

async function bench(name, runs, fn) {
  const durations = [];
  const errors = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    try {
      await fn();
      durations.push(performance.now() - t0);
    } catch (e) {
      errors.push(String(e?.message || e).slice(0, 200));
    }
  }
  return summarize(name, durations, errors);
}

async function main() {
  const results = [];

  // Capture baseline state to restore later
  const baseline = await health.healthCheck();
  console.error(`[baseline] symbol=${baseline.chart_symbol} resolution=${baseline.chart_resolution} type=${baseline.chart_type}`);

  // Pure reads — should be the fastest
  results.push(await bench('health.healthCheck', FAST_RUNS, () => health.healthCheck()));
  results.push(await bench('chart.getState',     FAST_RUNS, () => chart.getState()));
  results.push(await bench('data.getQuote',      FAST_RUNS, () => data.getQuote()));
  results.push(await bench('data.getOhlcv(summary)', RUNS, () => data.getOhlcv({ summary: true, count: 20 })));
  results.push(await bench('data.getOhlcv(100)', RUNS, () => data.getOhlcv({ count: 100 })));
  results.push(await bench('data.getStudyValues', RUNS, () => data.getStudyValues()));

  // Screenshot is heavy — fewer runs
  results.push(await bench('capture.screenshot(chart)', 5, () => capture.captureScreenshot({ region: 'chart' })));

  // Control round-trip: symbol toggle (use real symbols that exist on most accounts)
  const targets = ['NASDAQ:AAPL', 'NASDAQ:MSFT'];
  let toggle = 0;
  results.push(await bench('chart.setSymbol', 10, async () => {
    const sym = targets[toggle++ % targets.length];
    await chart.setSymbol({ symbol: sym });
  }));

  // Timeframe round-trip
  const tfs = ['D', '60', '15'];
  let tfi = 0;
  results.push(await bench('chart.setTimeframe', 10, async () => {
    await chart.setTimeframe({ timeframe: tfs[tfi++ % tfs.length] });
  }));

  // Restore baseline
  try {
    await chart.setSymbol({ symbol: baseline.chart_symbol });
    await chart.setTimeframe({ timeframe: baseline.chart_resolution });
    console.error(`[baseline] restored ${baseline.chart_symbol} ${baseline.chart_resolution}`);
  } catch (e) {
    console.error(`[baseline] restore failed: ${e.message}`);
  }

  // Print results
  console.log('');
  console.log('name'.padEnd(32) + ' n   ok  fail   min    p50   mean   p95    max');
  console.log('-'.repeat(85));
  for (const r of results) {
    console.log(
      r.name.padEnd(32) +
      ` ${String(r.n).padStart(2)}` +
      ` ${String(r.ok).padStart(4)}` +
      ` ${String(r.fail).padStart(4)}` +
      ` ${String(r.min).padStart(6)}` +
      ` ${String(r.p50).padStart(6)}` +
      ` ${String(r.mean).padStart(6)}` +
      ` ${String(r.p95).padStart(6)}` +
      ` ${String(r.max).padStart(6)}` +
      (r.fail ? `  err: ${r.errors[0]}` : '')
    );
  }

  await disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
