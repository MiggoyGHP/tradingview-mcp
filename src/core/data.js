/**
 * Core data access logic.
 */
import { evaluate, evaluateAsync, KNOWN_PATHS, safeString, getChartApi, getChartCollection } from '../connection.js';
import { waitForChartReady } from '../wait.js';

const MAX_OHLCV_BARS = 500;
const MAX_TRADES = 20;
const CHART_API = KNOWN_PATHS.chartApi;
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;

function buildGraphicsJS(collectionName, mapKey, filter) {
  return `
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      var filter = ${safeString(filter || '')};
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var items = [];
          try {
            var outer = pc.${collectionName};
            if (outer) {
              var inner = outer.get('${mapKey}');
              if (inner) {
                var coll = inner.get(false);
                if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
                  coll._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            }
          } catch(e) {}
          if (items.length === 0 && '${collectionName}' === 'dwgtablecells') {
            try {
              var tcOuter = pc.dwgtablecells;
              if (tcOuter) {
                var tcColl = tcOuter.get('tableCells');
                if (tcColl && tcColl._primitivesDataById && tcColl._primitivesDataById.size > 0) {
                  tcColl._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            } catch(e) {}
          }
          if (items.length > 0) results.push({name: name, count: items.length, items: items});
        } catch(e) {}
      }
      return results;
    })()
  `;
}

export async function getOhlcv({ count, summary, symbol } = {}) {
  const limit = Math.min(count || 100, MAX_OHLCV_BARS);

  let originalSymbol = null;
  let switched = false;
  if (symbol) {
    try {
      originalSymbol = await evaluateAsync(`(function() {
        var c = window.TradingViewApi._activeChartWidgetWV.value();
        return c.symbolExt().exchange + ':' + c.symbol();
      })()`);
    } catch {}
    let colPath, apiPath;
    try { colPath = await getChartCollection(); } catch {}
    try { if (!colPath) apiPath = await getChartApi(); } catch {}
    if (colPath) await evaluate(`${colPath}.setSymbol(${safeString(symbol)})`);
    else if (apiPath) await evaluate(`${apiPath}.setSymbol(${safeString(symbol)})`);
    const ready = await waitForChartReady(symbol);
    if (!ready) throw new Error(`Chart did not switch to ${symbol} within timeout`);
    await new Promise(r => setTimeout(r, 1500));
    switched = true;
  }

  let data;
  try {
    data = await evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var result = [];
        var end = bars.lastIndex();
        var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
        }
        return {bars: result, total_bars: bars.size(), source: 'direct_bars'};
      })()
    `);
  } catch { data = null; }

  if (switched && originalSymbol) {
    try {
      let colPath, apiPath;
      try { colPath = await getChartCollection(); } catch {}
      try { if (!colPath) apiPath = await getChartApi(); } catch {}
      if (colPath) await evaluate(`${colPath}.setSymbol(${safeString(originalSymbol)})`);
      else if (apiPath) await evaluate(`${apiPath}.setSymbol(${safeString(originalSymbol)})`);
    } catch {}
  }

  if (!data || !data.bars || data.bars.length === 0) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }

  if (summary) {
    const bars = data.bars;
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);
    const first = bars[0];
    const last = bars[bars.length - 1];
    return {
      success: true, bar_count: bars.length,
      period: { from: first.time, to: last.time },
      open: first.open, close: last.close,
      high: Math.max(...highs), low: Math.min(...lows),
      range: Math.round((Math.max(...highs) - Math.min(...lows)) * 100) / 100,
      change: Math.round((last.close - first.open) * 100) / 100,
      change_pct: Math.round(((last.close - first.open) / first.open) * 10000) / 100 + '%',
      avg_volume: Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length),
      last_5_bars: bars.slice(-5),
    };
  }

  return { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
}

export async function getIndicator({ entity_id }) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var study = api.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };
      var result = { name: null, inputs: null, visible: null };
      try { result.visible = study.isVisible(); } catch(e) {}
      try { result.inputs = study.getInputValues(); } catch(e) { result.inputs_error = e.message; }
      return result;
    })()
  `);

  if (data?.error) throw new Error(data.error);

  let inputs = data?.inputs;
  if (Array.isArray(inputs)) {
    inputs = inputs.filter(inp => {
      if (inp.id === 'text' && typeof inp.value === 'string' && inp.value.length > 200) return false;
      if (typeof inp.value === 'string' && inp.value.length > 500) return false;
      return true;
    });
  }
  return { success: true, entity_id, visible: data?.visible, inputs };
}

export async function getStrategyResults() {
  const results = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.reportData || s.performance)) { strat = s; break; }
        }
        if (!strat) return {metrics: {}, source: 'internal_api', error: 'No strategy found on chart. Add a strategy indicator first.'};
        var metrics = {};
        if (strat.reportData) {
          var rd = typeof strat.reportData === 'function' ? strat.reportData() : strat.reportData;
          if (rd && typeof rd === 'object') {
            if (typeof rd.value === 'function') rd = rd.value();
            if (rd) { var keys = Object.keys(rd); for (var k = 0; k < keys.length; k++) { var val = rd[keys[k]]; if (val !== null && val !== undefined && typeof val !== 'function') metrics[keys[k]] = val; } }
          }
        }
        if (Object.keys(metrics).length === 0 && strat.performance) {
          var perf = strat.performance();
          if (perf && typeof perf.value === 'function') perf = perf.value();
          if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { var pval = perf[pkeys[p]]; if (pval !== null && pval !== undefined && typeof pval !== 'function') metrics[pkeys[p]] = pval; } }
        }
        return {metrics: metrics, source: 'internal_api'};
      } catch(e) { return {metrics: {}, source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, metric_count: Object.keys(results?.metrics || {}).length, source: results?.source, metrics: results?.metrics || {}, error: results?.error };
}

export async function getTrades({ max_trades } = {}) {
  const limit = Math.min(max_trades || 20, MAX_TRADES);
  const trades = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.ordersData || s.reportData)) { strat = s; break; }
        }
        if (!strat) return {trades: [], source: 'internal_api', error: 'No strategy found on chart.'};
        var orders = null;
        if (strat.ordersData) { orders = typeof strat.ordersData === 'function' ? strat.ordersData() : strat.ordersData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        if (!orders || !Array.isArray(orders)) {
          if (strat._orders) orders = strat._orders;
          else if (strat.tradesData) { orders = typeof strat.tradesData === 'function' ? strat.tradesData() : strat.tradesData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        }
        if (!orders || !Array.isArray(orders)) return {trades: [], source: 'internal_api', error: 'ordersData() returned non-array.'};
        var result = [];
        for (var t = 0; t < Math.min(orders.length, ${limit}); t++) {
          var o = orders[t];
          if (typeof o === 'object' && o !== null) {
            var trade = {};
            var okeys = Object.keys(o);
            for (var k = 0; k < okeys.length; k++) { var v = o[okeys[k]]; if (v !== null && v !== undefined && typeof v !== 'function' && typeof v !== 'object') trade[okeys[k]] = v; }
            result.push(trade);
          }
        }
        return {trades: result, source: 'internal_api'};
      } catch(e) { return {trades: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, trade_count: trades?.trades?.length || 0, source: trades?.source, trades: trades?.trades || [], error: trades?.error };
}

export async function getEquity() {
  const equity = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.reportData || s.performance)) { strat = s; break; }
        }
        if (!strat) return {data: [], source: 'internal_api', error: 'No strategy found on chart.'};
        var data = [];
        if (strat.equityData) {
          var eq = typeof strat.equityData === 'function' ? strat.equityData() : strat.equityData;
          if (eq && typeof eq.value === 'function') eq = eq.value();
          if (Array.isArray(eq)) data = eq;
        }
        if (data.length === 0 && strat.bars) {
          var bars = typeof strat.bars === 'function' ? strat.bars() : strat.bars;
          if (bars && typeof bars.lastIndex === 'function') {
            var end = bars.lastIndex(); var start = bars.firstIndex();
            for (var i = start; i <= end; i++) { var v = bars.valueAt(i); if (v) data.push({time: v[0], equity: v[1], drawdown: v[2] || null}); }
          }
        }
        if (data.length === 0) {
          var perfData = {};
          if (strat.performance) {
            var perf = strat.performance();
            if (perf && typeof perf.value === 'function') perf = perf.value();
            if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { if (/equity|drawdown|profit|net/i.test(pkeys[p])) perfData[pkeys[p]] = perf[pkeys[p]]; } }
          }
          if (Object.keys(perfData).length > 0) return {data: [], equity_summary: perfData, source: 'internal_api', note: 'Full equity curve not available via API; equity summary metrics returned instead.'};
        }
        return {data: data, source: 'internal_api'};
      } catch(e) { return {data: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, data_points: equity?.data?.length || 0, source: equity?.source, data: equity?.data || [], equity_summary: equity?.equity_summary, note: equity?.note, error: equity?.error };
}

export async function getQuote({ symbol } = {}) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var sym = ${safeString(symbol || '')};
      if (!sym) { try { sym = api.symbol(); } catch(e) {} }
      if (!sym) { try { sym = api.symbolExt().symbol; } catch(e) {} }
      var ext = {};
      try { ext = api.symbolExt() || {}; } catch(e) {}
      var bars = ${BARS_PATH};
      var quote = { symbol: sym };
      if (bars && typeof bars.lastIndex === 'function') {
        var last = bars.valueAt(bars.lastIndex());
        if (last) { quote.time = last[0]; quote.open = last[1]; quote.high = last[2]; quote.low = last[3]; quote.close = last[4]; quote.last = last[4]; quote.volume = last[5] || 0; }
      }
      try {
        var bidEl = document.querySelector('[class*="bid"] [class*="price"], [class*="dom-"] [class*="bid"]');
        var askEl = document.querySelector('[class*="ask"] [class*="price"], [class*="dom-"] [class*="ask"]');
        if (bidEl) quote.bid = parseFloat(bidEl.textContent.replace(/[^0-9.\\-]/g, ''));
        if (askEl) quote.ask = parseFloat(askEl.textContent.replace(/[^0-9.\\-]/g, ''));
      } catch(e) {}
      try {
        var hdr = document.querySelector('[class*="headerRow"] [class*="last-"]');
        if (hdr) { var hdrPrice = parseFloat(hdr.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(hdrPrice)) quote.header_price = hdrPrice; }
      } catch(e) {}
      if (ext.description) quote.description = ext.description;
      if (ext.exchange) quote.exchange = ext.exchange;
      if (ext.type) quote.type = ext.type;
      return quote;
    })()
  `);
  if (!data || (!data.last && !data.close)) throw new Error('Could not retrieve quote. The chart may still be loading.');
  return { success: true, ...data };
}

export async function getDepth() {
  const data = await evaluate(`
    (function() {
      var domPanel = document.querySelector('[class*="depth"]')
        || document.querySelector('[class*="orderBook"]')
        || document.querySelector('[class*="dom-"]')
        || document.querySelector('[class*="DOM"]')
        || document.querySelector('[data-name="dom"]');
      if (!domPanel) return { found: false, error: 'DOM / Depth of Market panel not found.' };
      var bids = [], asks = [];
      var rows = domPanel.querySelectorAll('[class*="row"], tr');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var priceEl = row.querySelector('[class*="price"]');
        var sizeEl = row.querySelector('[class*="size"], [class*="volume"], [class*="qty"]');
        if (!priceEl) continue;
        var price = parseFloat(priceEl.textContent.replace(/[^0-9.\\-]/g, ''));
        var size = sizeEl ? parseFloat(sizeEl.textContent.replace(/[^0-9.\\-]/g, '')) : 0;
        if (isNaN(price)) continue;
        var rowClass = row.className || '';
        var rowHTML = row.innerHTML || '';
        if (/bid|buy/i.test(rowClass) || /bid|buy/i.test(rowHTML)) bids.push({ price, size });
        else if (/ask|sell/i.test(rowClass) || /ask|sell/i.test(rowHTML)) asks.push({ price, size });
        else if (i < rows.length / 2) asks.push({ price, size });
        else bids.push({ price, size });
      }
      if (bids.length === 0 && asks.length === 0) {
        var cells = domPanel.querySelectorAll('[class*="cell"], td');
        var prices = [];
        cells.forEach(function(c) { var val = parseFloat(c.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(val) && val > 0) prices.push(val); });
        if (prices.length > 0) return { found: true, raw_values: prices.slice(0, 50), bids: [], asks: [], note: 'Could not classify bid/ask levels.' };
      }
      bids.sort(function(a, b) { return b.price - a.price; });
      asks.sort(function(a, b) { return a.price - b.price; });
      var spread = null;
      if (asks.length > 0 && bids.length > 0) spread = +(asks[0].price - bids[0].price).toFixed(6);
      return { found: true, bids: bids, asks: asks, spread: spread };
    })()
  `);

  if (!data || !data.found) throw new Error(data?.error || 'DOM panel not found.');
  return { success: true, bid_levels: data.bids?.length || 0, ask_levels: data.asks?.length || 0, spread: data.spread, bids: data.bids || [], asks: data.asks || [], raw_values: data.raw_values, note: data.note };
}

export async function getStudyValues() {
  const data = await evaluate(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          var values = {};
          try {
            var dwv = s.dataWindowView();
            if (dwv) {
              var items = dwv.items();
              if (items) {
                for (var i = 0; i < items.length; i++) {
                  var item = items[i];
                  if (item._value && item._value !== '∅' && item._title) values[item._title] = item._value;
                }
              }
            }
          } catch(e) {}
          if (Object.keys(values).length > 0) results.push({ name: name, values: values });
        } catch(e) {}
      }
      return results;
    })()
  `);
  return { success: true, study_count: data?.length || 0, studies: data || [] };
}

export async function getPineLines({ study_filter, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwglines', 'lines', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const hLevels = [];
    const seen = {};
    const allLines = [];
    for (const item of s.items) {
      const v = item.raw;
      const y1 = v.y1 != null ? Math.round(v.y1 * 100) / 100 : null;
      const y2 = v.y2 != null ? Math.round(v.y2 * 100) / 100 : null;
      if (verbose) allLines.push({ id: item.id, y1, y2, x1: v.x1, x2: v.x2, horizontal: v.y1 === v.y2, style: v.st, width: v.w, color: v.ci });
      if (y1 != null && v.y1 === v.y2 && !seen[y1]) { hLevels.push(y1); seen[y1] = true; }
    }
    hLevels.sort((a, b) => b - a);
    const result = { name: s.name, total_lines: s.count, horizontal_levels: hLevels };
    if (verbose) result.all_lines = allLines;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineLabels({ study_filter, max_labels, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwglabels', 'labels', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const limit = max_labels || 50;
  const studies = raw.map(s => {
    let labels = s.items.map(item => {
      const v = item.raw;
      const text = v.t || '';
      const price = v.y != null ? Math.round(v.y * 100) / 100 : null;
      if (verbose) return { id: item.id, text, price, x: v.x, yloc: v.yl, size: v.sz, textColor: v.tci, color: v.ci };
      return { text, price };
    }).filter(l => l.text || l.price != null);
    if (labels.length > limit) labels = labels.slice(-limit);
    return { name: s.name, total_labels: s.count, showing: labels.length, labels };
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineTables({ study_filter } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgtablecells', 'tableCells', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const tables = {};
    for (const item of s.items) {
      const v = item.raw;
      const tid = v.tid || 0;
      if (!tables[tid]) tables[tid] = {};
      if (!tables[tid][v.row]) tables[tid][v.row] = {};
      tables[tid][v.row][v.col] = v.t || '';
    }
    const tableList = Object.entries(tables).map(([tid, rows]) => {
      const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const formatted = rowNums.map(rn => {
        const cols = rows[rn];
        const colNums = Object.keys(cols).map(Number).sort((a, b) => a - b);
        return colNums.map(cn => cols[cn]).filter(Boolean).join(' | ');
      }).filter(Boolean);
      return { rows: formatted };
    });
    return { name: s.name, tables: tableList };
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineBoxes({ study_filter, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgboxes', 'boxes', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const zones = [];
    const seen = {};
    const allBoxes = [];
    for (const item of s.items) {
      const v = item.raw;
      const high = v.y1 != null && v.y2 != null ? Math.round(Math.max(v.y1, v.y2) * 100) / 100 : null;
      const low = v.y1 != null && v.y2 != null ? Math.round(Math.min(v.y1, v.y2) * 100) / 100 : null;
      if (verbose) allBoxes.push({ id: item.id, high, low, x1: v.x1, x2: v.x2, borderColor: v.c, bgColor: v.bc });
      if (high != null && low != null) { const key = high + ':' + low; if (!seen[key]) { zones.push({ high, low }); seen[key] = true; } }
    }
    zones.sort((a, b) => b.high - a.high);
    const result = { name: s.name, total_boxes: s.count, zones };
    if (verbose) result.all_boxes = allBoxes;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}

// --- New data scrapers using TradingView REST APIs via browser fetch ---

function resolveSymbolExpr(symbol) {
  if (symbol) return `Promise.resolve(${safeString(symbol)})`;
  return `(function() {
    var c = window.TradingViewApi._activeChartWidgetWV.value();
    return Promise.resolve(c.symbolExt().exchange + ':' + c.symbol());
  })()`;
}

function screenerMarket(sym) {
  if (/^PSX:/i.test(sym)) return 'global';
  if (/^(NASDAQ:|NYSE:|AMEX:|CBOE:|BATS:)/i.test(sym)) return 'america';
  return 'global';
}

export async function getFundamentals({ symbol } = {}) {
  const sym = await evaluateAsync(`(${resolveSymbolExpr(symbol)})`);

  const result = await evaluateAsync(`
    (async function() {
      var sym = ${safeString(sym)};
      var host = window.SCREENER_HOST || 'https://scanner.tradingview.com';
      var market = /^PSX:/i.test(sym) ? 'global' : (/^(NASDAQ|NYSE|AMEX|CBOE|BATS):/i.test(sym) ? 'america' : 'global');
      var url = host + '/' + market + '/scan';
      var columns = [
        'name','close','market_cap_calc','P.EARNINGS','Price_to_Book_ratio_FQ',
        'EPS_Diluted_TTM','Revenue_Annual','Net_Income_Annual','Total_Debt_Annual',
        'Dividends_Paid_Annual','EV_EBITDA','Return_on_Equity','Gross_Profit_Margin',
        'Net_Income_Margin','Current_Ratio_Annual','Debt_Ratio_Annual',
        'earnings_release_date_fq','sector','industry','exchange','type','description',
        'Revenue_QoQ','Revenue_YoY','EPS_Diluted_YoY',
        'Return_on_Assets','ROCE_TTM',
        'Quick_Ratio_Annual','Debt_to_Equity',
        'EPS_Estimate_FY1','Revenue_Estimate_FY1',
        'dividend_yield_calc','dividends_per_share'
      ];
      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ symbols: { tickers: [sym] }, columns: columns })
      });
      if (!resp.ok) return { error: 'HTTP ' + resp.status };
      return await resp.json();
    })()
  `);

  if (!result || result.error) throw new Error(result?.error || 'Failed to fetch fundamentals');

  const row = result.data?.[0]?.d;
  if (!row) return { success: true, symbol: sym, fundamentals: null, message: 'No fundamental data available for this symbol' };

  const keys = [
    'name','price','market_cap','pe_ratio','pb_ratio','eps_ttm',
    'revenue_annual','net_income_annual','total_debt','dividends_paid',
    'ev_ebitda','roe','gross_margin','net_margin','current_ratio',
    'debt_ratio','next_earnings_date','sector','industry','exchange','type','description',
    'revenue_qoq','revenue_yoy','eps_diluted_yoy',
    'roa','roce',
    'quick_ratio','debt_to_equity',
    'eps_estimate_fy1','revenue_estimate_fy1',
    'dividend_yield','dividends_per_share'
  ];
  const fundamentals = {};
  keys.forEach((k, i) => { fundamentals[k] = row[i] ?? null; });

  return { success: true, symbol: sym, fundamentals };
}

export async function getEconomicCalendar({ from, to, countries, impact } = {}) {
  const fromDate = from || new Date().toISOString().split('T')[0];
  const toDate = to || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const result = await evaluateAsync(`
    (async function() {
      var baseUrl = window.ECONOMIC_CALENDAR_URL || 'https://economic-calendar.tradingview.com/';
      var url = baseUrl + 'events?from=' + encodeURIComponent(${safeString(fromDate + 'T00:00:00.000Z')}) +
                '&to=' + encodeURIComponent(${safeString(toDate + 'T23:59:59.999Z')});
      var resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) return { error: 'HTTP ' + resp.status };
      return await resp.json();
    })()
  `);

  if (!result || result.error) throw new Error(result?.error || 'Failed to fetch economic calendar');

  let events = Array.isArray(result) ? result : (result.result || result.events || []);

  if (countries?.length) {
    const ctrySet = new Set(countries.map(c => c.toUpperCase()));
    events = events.filter(e => ctrySet.has((e.country || '').toUpperCase()));
  }
  if (impact && impact !== 'all') {
    const minImp = { high: 3, medium: 2, low: 1 }[impact] || 0;
    events = events.filter(e => (e.importance ?? 0) >= minImp);
  }

  return {
    success: true,
    from: fromDate,
    to: toDate,
    event_count: events.length,
    events: events.map(e => ({
      date: e.date,
      time: e.time,
      country: e.country,
      name: e.title || e.name,
      impact: e.importance === 3 ? 'high' : e.importance === 2 ? 'medium' : 'low',
      actual: e.actual ?? null,
      forecast: e.forecast ?? null,
      previous: e.previous ?? null,
      currency: e.currency ?? null,
    })),
  };
}

export async function getHoldings({ symbol } = {}) {
  const sym = await evaluateAsync(`(${resolveSymbolExpr(symbol)})`);
  const symType = await evaluateAsync(`(function() {
    var c = window.TradingViewApi._activeChartWidgetWV.value();
    return c.symbolExt().type || null;
  })()`);

  // Use screener to get available ETF/security metadata
  const result = await evaluateAsync(`
    (async function() {
      var sym = ${safeString(sym)};
      var host = window.SCREENER_HOST || 'https://scanner.tradingview.com';
      var market = /^PSX:/i.test(sym) ? 'global' : (/^(NASDAQ|NYSE|AMEX|CBOE|BATS):/i.test(sym) ? 'america' : 'global');
      var url = host + '/' + market + '/scan';
      var columns = [
        'name','type','description','sector','industry','market_cap_calc',
        'assets_under_management','number_of_employees','exchange',
        'shares_outstanding','float_shares_outstanding',
        'institutional_holding','insider_holding'
      ];
      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ symbols: { tickers: [sym] }, columns: columns })
      });
      if (!resp.ok) return { error: 'HTTP ' + resp.status };
      return await resp.json();
    })()
  `);

  if (!result || result.error) throw new Error(result?.error || 'Failed to fetch holdings data');

  const row = result.data?.[0]?.d;
  if (!row) return { success: true, symbol: sym, holdings: null, message: 'No holdings data available' };

  const [name, type, description, sector, industry, market_cap, aum, employees, exchange,
    shares_outstanding, float_shares, institutional_pct, insider_pct] = row;

  return {
    success: true,
    symbol: sym,
    type: type || symType,
    name,
    description,
    exchange,
    sector,
    industry,
    ownership: {
      market_cap,
      assets_under_management: aum,
      shares_outstanding,
      float_shares,
      institutional_holding_pct: institutional_pct,
      insider_holding_pct: insider_pct,
      employees,
    },
    note: 'For ETF individual holdings composition, open the Holdings panel in TradingView and use data_get_holdings_detail (coming soon).',
  };
}

export async function screenStocks({ market = 'america', filters = [], sort_by = 'market_cap_calc', sort_order = 'desc', limit = 50, fields } = {}) {
  const opMap = { gt: 'egreater', lt: 'eless', eq: 'equal', neq: 'nequal', between: 'in_range', not_between: 'not_in_range' };
  const screenerFilters = (filters || []).map(f => ({
    left: f.field,
    operation: opMap[f.op] || f.op,
    right: f.value,
  }));
  const defaultFields = ['name', 'close', 'change|1D', 'market_cap_calc', 'P.EARNINGS', 'Revenue_YoY', 'EPS_Diluted_YoY', 'sector', 'industry'];
  const columns = fields && fields.length > 0 ? fields : defaultFields;
  const rangeLimit = Math.min(limit || 50, 200);

  const body = {
    filter: screenerFilters,
    sort: { sortBy: sort_by || 'market_cap_calc', sortOrder: sort_order || 'desc' },
    range: [0, rangeLimit],
    columns,
    options: { lang: 'en' },
  };
  const bodyJson = JSON.stringify(body);

  const result = await evaluateAsync(`
    (async function() {
      var host = window.SCREENER_HOST || 'https://scanner.tradingview.com';
      var url = host + '/' + ${safeString(market)} + '/scan';
      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: ${safeString(bodyJson)}
      });
      if (!resp.ok) return { error: 'HTTP ' + resp.status };
      return await resp.json();
    })()
  `);

  if (!result || result.error) throw new Error(result?.error || 'Screener request failed');

  function toKey(col) {
    return col.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/, '').toLowerCase();
  }

  const rows = result.data || [];
  const stocks = rows.map(row => {
    const obj = { symbol: row.s };
    columns.forEach((col, i) => { obj[toKey(col)] = row.d?.[i] ?? null; });
    return obj;
  });

  return { success: true, market, count: stocks.length, stocks };
}

export async function getFinancials({ symbol, period = 'both' } = {}) {
  const sym = await evaluateAsync(`(${resolveSymbolExpr(symbol)})`);

  const annualCols = [
    'name', 'close', 'market_cap_calc',
    'Revenue_Annual', 'Revenue_YoY', 'Gross_Profit_Annual', 'EBITDA_Annual',
    'Net_Income_Annual', 'EPS_Diluted_FY', 'Operating_Expense_Annual',
  ];
  const quarterlyCols = [
    'Revenue_FQ', 'Revenue_QoQ', 'Revenue_YoY',
    'Gross_Profit_FQ', 'EBITDA_FQ', 'Net_Income_FQ', 'EPS_Diluted_FQ',
  ];
  const balanceCols = [
    'Total_Assets_Annual', 'Total_Liabilities_Annual', 'Cash_F_Equiv_Annual',
    'Long_LT_Debt_Annual', 'Total_Equity_Annual',
  ];
  const cashflowCols = [
    'Free_Cash_Flow_TTM', 'Cash_From_Operations_Annual', 'CapEx_Annual',
  ];
  const ratioCols = [
    'P.EARNINGS', 'P.SALES', 'Price_to_Book_ratio_FQ', 'EV_EBITDA',
    'Return_on_Equity', 'Return_on_Assets', 'ROCE_TTM',
    'Gross_Profit_Margin', 'Net_Income_Margin', 'Operating_Margin',
    'Current_Ratio_Annual', 'Quick_Ratio_Annual', 'Debt_to_Equity', 'Debt_Ratio_Annual',
  ];
  const estimateCols = [
    'EPS_Estimate_FY1', 'EPS_Estimate_FY2',
    'Revenue_Estimate_FY1', 'Revenue_Estimate_FY2',
    'earnings_release_date_fq',
  ];

  let columns;
  if (period === 'annual') columns = [...annualCols, ...balanceCols, ...cashflowCols, ...ratioCols, ...estimateCols];
  else if (period === 'quarterly') columns = ['name', 'close', 'market_cap_calc', ...quarterlyCols, ...ratioCols, ...estimateCols];
  else columns = [...annualCols, ...quarterlyCols, ...balanceCols, ...cashflowCols, ...ratioCols, ...estimateCols];

  const deduped = [...new Set(columns)];
  const bodyJson = JSON.stringify({ symbols: { tickers: [sym] }, columns: deduped });
  const market = screenerMarket(sym);

  const result = await evaluateAsync(`
    (async function() {
      var host = window.SCREENER_HOST || 'https://scanner.tradingview.com';
      var url = host + '/' + ${safeString(market)} + '/scan';
      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: ${safeString(bodyJson)}
      });
      if (!resp.ok) return { error: 'HTTP ' + resp.status };
      return await resp.json();
    })()
  `);

  if (!result || result.error) throw new Error(result?.error || 'Failed to fetch financials');
  const row = result.data?.[0]?.d;
  if (!row) return { success: true, symbol: sym, financials: null, message: 'No financial data available for this symbol' };

  const mapped = {};
  deduped.forEach((col, i) => { mapped[col] = row[i] ?? null; });

  const out = { success: true, symbol: sym, period };

  if (period !== 'quarterly') {
    out.income_annual = {
      revenue: mapped['Revenue_Annual'],
      revenue_yoy_pct: mapped['Revenue_YoY'],
      gross_profit: mapped['Gross_Profit_Annual'],
      ebitda: mapped['EBITDA_Annual'],
      net_income: mapped['Net_Income_Annual'],
      eps_diluted: mapped['EPS_Diluted_FY'],
    };
    out.balance_sheet = {
      total_assets: mapped['Total_Assets_Annual'],
      total_liabilities: mapped['Total_Liabilities_Annual'],
      cash_equivalents: mapped['Cash_F_Equiv_Annual'],
      long_term_debt: mapped['Long_LT_Debt_Annual'],
      total_equity: mapped['Total_Equity_Annual'],
    };
    out.cash_flow = {
      free_cash_flow_ttm: mapped['Free_Cash_Flow_TTM'],
      operating_cash_flow: mapped['Cash_From_Operations_Annual'],
      capex: mapped['CapEx_Annual'],
    };
  }

  if (period !== 'annual') {
    out.income_quarterly = {
      revenue: mapped['Revenue_FQ'],
      revenue_qoq_pct: mapped['Revenue_QoQ'],
      revenue_yoy_pct: mapped['Revenue_YoY'],
      gross_profit: mapped['Gross_Profit_FQ'],
      ebitda: mapped['EBITDA_FQ'],
      net_income: mapped['Net_Income_FQ'],
      eps_diluted: mapped['EPS_Diluted_FQ'],
    };
  }

  out.ratios = {
    pe: mapped['P.EARNINGS'],
    ps: mapped['P.SALES'],
    pb: mapped['Price_to_Book_ratio_FQ'],
    ev_ebitda: mapped['EV_EBITDA'],
    roe: mapped['Return_on_Equity'],
    roa: mapped['Return_on_Assets'],
    roce: mapped['ROCE_TTM'],
    gross_margin: mapped['Gross_Profit_Margin'],
    net_margin: mapped['Net_Income_Margin'],
    operating_margin: mapped['Operating_Margin'],
    current_ratio: mapped['Current_Ratio_Annual'],
    quick_ratio: mapped['Quick_Ratio_Annual'],
    debt_to_equity: mapped['Debt_to_Equity'],
    debt_ratio: mapped['Debt_Ratio_Annual'],
  };

  out.estimates = {
    eps_fy1: mapped['EPS_Estimate_FY1'],
    eps_fy2: mapped['EPS_Estimate_FY2'],
    revenue_fy1: mapped['Revenue_Estimate_FY1'],
    revenue_fy2: mapped['Revenue_Estimate_FY2'],
    next_earnings_date: mapped['earnings_release_date_fq'],
  };

  return out;
}

export async function getEarningsCalendar({ from, to, market = 'america', limit = 100 } = {}) {
  const fromDate = from || new Date().toISOString().split('T')[0];
  const toDate = to || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const rangeLimit = Math.min(limit || 100, 200);

  const columns = [
    'name', 'close', 'market_cap_calc', 'earnings_release_date_fq',
    'EPS_Estimate_FY1', 'Revenue_Estimate_FY1', 'EPS_Diluted_TTM',
    'Revenue_Annual', 'sector', 'type',
  ];
  const body = {
    filter: [
      { left: 'earnings_release_date_fq', operation: 'in_range', right: [fromDate, toDate] },
      { left: 'type', operation: 'equal', right: 'stock' },
    ],
    sort: { sortBy: 'market_cap_calc', sortOrder: 'desc' },
    range: [0, rangeLimit],
    columns,
    options: { lang: 'en' },
  };
  const bodyJson = JSON.stringify(body);

  const result = await evaluateAsync(`
    (async function() {
      var host = window.SCREENER_HOST || 'https://scanner.tradingview.com';
      var url = host + '/' + ${safeString(market)} + '/scan';
      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: ${safeString(bodyJson)}
      });
      if (!resp.ok) return { error: 'HTTP ' + resp.status };
      return await resp.json();
    })()
  `);

  if (!result || result.error) throw new Error(result?.error || 'Failed to fetch earnings calendar');

  const rows = result.data || [];
  const reporters = rows.map(row => {
    const [name, price, market_cap, earnings_date, eps_estimate, rev_estimate, eps_ttm, revenue_annual, sector] = row.d || [];
    return {
      symbol: row.s,
      name,
      price,
      market_cap,
      earnings_date,
      eps_estimate_fy1: eps_estimate,
      revenue_estimate_fy1: rev_estimate,
      eps_ttm,
      revenue_annual,
      sector,
    };
  });

  return { success: true, from: fromDate, to: toDate, market, count: reporters.length, reporters };
}

export async function getBulk({ symbols, fields } = {}) {
  if (!symbols || symbols.length === 0) throw new Error('symbols array is required');
  const tickers = symbols.slice(0, 50);

  const defaultFields = [
    'name', 'close', 'market_cap_calc', 'P.EARNINGS', 'EPS_Diluted_TTM',
    'Revenue_Annual', 'Revenue_YoY', 'Net_Income_Margin', 'Return_on_Equity',
    'earnings_release_date_fq', 'sector', 'industry', 'exchange',
  ];
  const columns = fields && fields.length > 0 ? fields : defaultFields;

  const markets = [...new Set(tickers.map(s => screenerMarket(s)))];

  const fetchForMarket = async (market, mTickers) => {
    const bodyJson = JSON.stringify({ symbols: { tickers: mTickers }, columns });
    return evaluateAsync(`
      (async function() {
        var host = window.SCREENER_HOST || 'https://scanner.tradingview.com';
        var url = host + '/' + ${safeString(market)} + '/scan';
        var resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: ${safeString(bodyJson)}
        });
        if (!resp.ok) return { error: 'HTTP ' + resp.status };
        return await resp.json();
      })()
    `);
  };

  function toKey(col) {
    return col.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/, '').toLowerCase();
  }

  const allRows = [];
  for (const market of markets) {
    const mTickers = tickers.filter(s => screenerMarket(s) === market);
    const result = await fetchForMarket(market, mTickers);
    if (result && !result.error && result.data) {
      for (const row of result.data) {
        const obj = { symbol: row.s };
        columns.forEach((col, i) => { obj[toKey(col)] = row.d?.[i] ?? null; });
        allRows.push(obj);
      }
    }
  }

  return { success: true, requested: tickers.length, returned: allRows.length, fields: columns.map(toKey), data: allRows };
}

export async function getNews({ symbol, count = 20 } = {}) {
  const sym = await evaluateAsync(`(${resolveSymbolExpr(symbol)})`);
  const limit = Math.min(parseInt(count, 10) || 20, 100);

  const result = await evaluateAsync(`
    (async function() {
      var sym = ${safeString(sym)};
      var base = window.NEWS_SERVICE_URL || 'https://news-headlines.tradingview.com';
      var url = base + '/v2/view/asset/news?symbol=' + encodeURIComponent(sym) +
                '&client=web&lang=en&section=symbol&limit=' + ${limit};
      var resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) return { error: 'HTTP ' + resp.status };
      return await resp.json();
    })()
  `);

  if (!result || result.error) throw new Error(result?.error || 'Failed to fetch news');

  const items = Array.isArray(result) ? result : (result.items || result.news || []);

  return {
    success: true,
    symbol: sym,
    count: items.length,
    articles: items.map(n => ({
      id: n.id || n.storyPath || null,
      time: n.published || n.publishedAt || n.created_at || null,
      title: n.title || null,
      source: n.source || n.provider || null,
      url: n.link || n.storyPath || null,
      summary: n.shortDescription || n.description || null,
      related_symbols: n.relatedSymbols || n.tickers || [],
    })),
  };
}
