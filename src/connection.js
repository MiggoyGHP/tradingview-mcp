import CDP from 'chrome-remote-interface';

let client = null;
let targetInfo = null;
let effectivePort = null;
const CDP_HOST = process.env.TV_MCP_CDP_HOST || 'localhost';
const CDP_PORT = parseInt(process.env.TV_MCP_CDP_PORT || '9222', 10);
const MAX_RETRIES = 5;
const BASE_DELAY = 500;

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

/**
 * Sanitize a string for safe interpolation into JavaScript code evaluated via CDP.
 * Uses JSON.stringify to produce a properly escaped JS string literal (with quotes).
 * Prevents injection via quotes, backticks, template literals, or control chars.
 */
export function safeString(str) {
  return JSON.stringify(String(str));
}

/**
 * Validate that a value is a finite number. Throws if NaN, Infinity, or non-numeric.
 * Prevents corrupt values from reaching TradingView APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${value}`);
  return n;
}

export async function getClient() {
  if (client) {
    try {
      // Quick liveness check
      await client.Runtime.evaluate({ expression: '1', returnByValue: true });
      return client;
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connect();
}

export async function connect() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const target = await findChartTarget();
      if (!target) {
        throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      }
      targetInfo = target;
      client = await CDP({ host: CDP_HOST, port: effectivePort, target: target.id });

      // Enable required domains
      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();

      // Security: log connection details and warn if not localhost
      process.stderr.write(`[security] CDP connected on ${CDP_HOST}:${effectivePort}\n`);
      if (CDP_HOST !== 'localhost' && CDP_HOST !== '127.0.0.1') {
        process.stderr.write(`[security] WARNING: CDP_HOST is "${CDP_HOST}", not localhost. This may expose the debug port to your network.\n`);
      }

      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function findChartTarget() {
  // Scan primary port first, then nearby ports — handles cases where TradingView
  // picked a different debug port or was launched with a custom port.
  const portsToScan = [CDP_PORT];
  for (let i = 1; i <= 10; i++) portsToScan.push(CDP_PORT + i);

  for (const port of portsToScan) {
    try {
      const resp = await fetch(`http://${CDP_HOST}:${port}/json/list`,
        { signal: AbortSignal.timeout(800) });
      const targets = await resp.json();
      const t = targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
             || targets.find(t => t.type === 'page' && /tradingview/i.test(t.url));
      if (t) { effectivePort = port; return t; }
    } catch { /* port not open, try next */ }
  }
  return null;
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  return targetInfo;
}

// Default per-CDP-call timeout. Without this, a TradingView async API that
// never resolves can hang an MCP tool call forever (Claude waits indefinitely).
// Tune with TV_MCP_EVAL_TIMEOUT_MS. Pass opts.timeoutMs to override per call.
const EVAL_TIMEOUT_MS = Number(process.env.TV_MCP_EVAL_TIMEOUT_MS || 30000);

export async function evaluate(expression, opts = {}) {
  const c = await getClient();
  // Destructure known non-CDP fields so they don't pollute the protocol message.
  // Safety fields (returnByValue, expression) come AFTER the spread so callers
  // cannot accidentally override them.
  const { timeoutMs: _t, awaitPromise, ...cdpOpts } = opts;
  const evalPromise = c.Runtime.evaluate({
    ...cdpOpts,
    expression,
    returnByValue: true,
    awaitPromise: awaitPromise ?? false,
  });
  const timeoutMs = opts.timeoutMs ?? EVAL_TIMEOUT_MS;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`CDP evaluate timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  let result;
  try {
    result = await Promise.race([evalPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

/**
 * Make an HTTP request from Node.js using session cookies from the TradingView browser.
 * Bypasses browser CORS restrictions — use for cross-origin API calls (scanner, news, etc.)
 */
export async function serverFetch(url, options = {}) {
  const c = await getClient();
  try { await c.Network.enable(); } catch {}
  const { cookies } = await c.Network.getCookies({ urls: [url] });
  const cookieStr = (cookies || []).map(ck => `${ck.name}=${ck.value}`).join('; ');
  const headers = { ...options.headers };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (cookieStr) headers['Cookie'] = cookieStr;
  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    let body; try { body = await resp.text(); } catch {}
    return { error: `HTTP ${resp.status}`, body };
  }
  return resp.json();
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
