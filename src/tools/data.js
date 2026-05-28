import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/data.js';

export function registerDataTools(server) {
  server.tool('data_get_ohlcv', 'Get OHLCV bar data from the chart. Use summary=true for compact stats. Pass symbol to fetch bars for any ticker (temporarily switches chart then restores).', {
    count: z.coerce.number().optional().describe('Number of bars to retrieve (max 500, default 100)'),
    summary: z.coerce.boolean().optional().describe('Return summary stats (high, low, open, close, avg volume, range) instead of all bars — much smaller output'),
    symbol: z.string().optional().describe('Symbol to fetch bars for (e.g. NASDAQ:AAPL). Defaults to current chart symbol. Temporarily switches chart if provided.'),
  }, async ({ count, summary, symbol }) => {
    try { return jsonResult(await core.getOhlcv({ count, summary, symbol })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_indicator', 'Get indicator/study info and input values', {
    entity_id: z.string().describe('Study entity ID (from chart_get_state)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.getIndicator({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_strategy_results', 'Get strategy performance metrics from Strategy Tester', {}, async () => {
    try { return jsonResult(await core.getStrategyResults()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_trades', 'Get trade list from Strategy Tester', {
    max_trades: z.coerce.number().optional().describe('Maximum trades to return'),
  }, async ({ max_trades }) => {
    try { return jsonResult(await core.getTrades({ max_trades })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_equity', 'Get equity curve data from Strategy Tester', {}, async () => {
    try { return jsonResult(await core.getEquity()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('quote_get', 'Get real-time quote data for a symbol (price, OHLC, volume)', {
    symbol: z.string().optional().describe('Symbol to quote (blank = current chart symbol)'),
  }, async ({ symbol }) => {
    try { return jsonResult(await core.getQuote({ symbol })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('depth_get', 'Get order book / DOM (Depth of Market) data from the chart', {}, async () => {
    try { return jsonResult(await core.getDepth()); }
    catch (err) { return jsonResult({ success: false, error: err.message, hint: 'Open the DOM panel in TradingView before using this tool.' }, true); }
  });

  server.tool('data_get_pine_lines', 'Read horizontal price levels drawn by Pine Script indicators (line.new). Returns deduplicated price levels per study. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name (e.g., "Profiler", "NY Levels"). Omit for all.'),
    verbose: z.coerce.boolean().optional().describe('Return raw line data with IDs, coordinates, colors (default false — returns only unique price levels)'),
  }, async ({ study_filter, verbose }) => {
    try { return jsonResult(await core.getPineLines({ study_filter, verbose })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_pine_labels', 'Read text labels drawn by Pine Script indicators (label.new). Returns text and price pairs. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    max_labels: z.coerce.number().optional().describe('Max labels per study (default 50). Set higher if you need all.'),
    verbose: z.coerce.boolean().optional().describe('Return raw label data with IDs, colors, positions (default false — returns only text + price)'),
  }, async ({ study_filter, max_labels, verbose }) => {
    try { return jsonResult(await core.getPineLabels({ study_filter, max_labels, verbose })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_pine_tables', 'Read table data drawn by Pine Script indicators (table.new). Returns formatted text rows per table. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
  }, async ({ study_filter }) => {
    try { return jsonResult(await core.getPineTables({ study_filter })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_pine_boxes', 'Read box/zone boundaries drawn by Pine Script indicators (box.new). Returns deduplicated {high, low} price zones. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    verbose: z.coerce.boolean().optional().describe('Return all boxes with IDs and coordinates (default false — returns unique price zones)'),
  }, async ({ study_filter, verbose }) => {
    try { return jsonResult(await core.getPineBoxes({ study_filter, verbose })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_study_values', 'Get current indicator values from the data window for all visible studies (RSI, MACD, Bollinger Bands, EMAs, custom indicators with plot()).', {}, async () => {
    try { return jsonResult(await core.getStudyValues()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_fundamentals', 'Get fundamental / FactSet snapshot for a symbol: P/E, EPS, revenue, margins, debt, growth rates (YoY/QoQ), ROA, ROCE, quick ratio, D/E, forward EPS/revenue estimates, dividend yield, earnings date. US + global stocks.', {
    symbol: z.string().optional().describe('Symbol to look up (e.g. NASDAQ:AAPL, PSX:SM). Defaults to current chart symbol.'),
  }, async ({ symbol }) => {
    try { return jsonResult(await core.getFundamentals({ symbol })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_economic_calendar', 'Get upcoming economic calendar events from TradingView (CPI, NFP, FOMC, GDP, etc.). Filter by date range, countries, and impact level.', {
    from: z.string().optional().describe('Start date ISO format (e.g. "2026-05-27"). Defaults to today.'),
    to: z.string().optional().describe('End date ISO format (e.g. "2026-06-03"). Defaults to 7 days from now.'),
    countries: z.array(z.string()).optional().describe('Country codes to filter (e.g. ["US", "EU", "PH", "JP"]). Omit for all.'),
    impact: z.enum(['high', 'medium', 'low', 'all']).optional().describe('Minimum impact level filter. Defaults to all.'),
  }, async ({ from, to, countries, impact }) => {
    try { return jsonResult(await core.getEconomicCalendar({ from, to, countries, impact })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_holdings', 'Get ownership, institutional/insider holding percentages, and fund metadata for a symbol. For ETFs: shows AUM. For stocks: shows institutional/insider pct.', {
    symbol: z.string().optional().describe('Symbol to look up (e.g. AMEX:SPY, NASDAQ:AAPL). Defaults to current chart symbol.'),
  }, async ({ symbol }) => {
    try { return jsonResult(await core.getHoldings({ symbol })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_news', 'Get recent news headlines for a symbol from TradingView news feed.', {
    symbol: z.string().optional().describe('Symbol to get news for (e.g. NASDAQ:AAPL, PSX:SM). Defaults to current chart symbol.'),
    count: z.coerce.number().optional().describe('Number of articles to return (default 20, max 100).'),
  }, async ({ symbol, count }) => {
    try { return jsonResult(await core.getNews({ symbol, count })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_screen', `Screen the stock universe by financial or technical criteria using TradingView's screener API. Returns a ranked list of stocks matching your filters. No chart required.

Common fields: market_cap_calc, P.EARNINGS (P/E), P.SALES (P/S), Price_to_Book_ratio_FQ, EV_EBITDA, Revenue_YoY, Revenue_QoQ, EPS_Diluted_YoY, EPS_Diluted_TTM, Gross_Profit_Margin, Net_Income_Margin, Return_on_Equity, Return_on_Assets, Debt_to_Equity, Current_Ratio_Annual, close, sector, industry, exchange, earnings_release_date_fq.
Operators: gt (>), lt (<), eq (=), neq (≠), between ([min,max]), not_between.`, {
    market: z.enum(['america', 'global', 'crypto', 'forex']).optional().describe('Market universe to screen (default: america)'),
    filters: z.array(z.object({
      field: z.string().describe('Screener column name (e.g. market_cap_calc, P.EARNINGS, Revenue_YoY)'),
      op: z.enum(['gt', 'lt', 'eq', 'neq', 'between', 'not_between']).describe('Comparison operator'),
      value: z.union([z.number(), z.string(), z.array(z.number())]).describe('Value to compare against (use array [min,max] for between/not_between)'),
    })).optional().describe('Filter conditions. Omit for unfiltered list sorted by sort_by.'),
    sort_by: z.string().optional().describe('Column to sort by (default: market_cap_calc)'),
    sort_order: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc)'),
    limit: z.coerce.number().optional().describe('Max results to return (default 50, max 200)'),
    fields: z.array(z.string()).optional().describe('Columns to return. Default: name, close, change_1d, market_cap_calc, P.EARNINGS, Revenue_YoY, EPS_Diluted_YoY, sector, industry'),
  }, async ({ market, filters, sort_by, sort_order, limit, fields }) => {
    try { return jsonResult(await core.screenStocks({ market, filters, sort_by, sort_order, limit, fields })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_financials', 'Get full financial statements for a symbol: income statement (annual + quarterly), balance sheet, cash flow, key ratios, and forward estimates. FactSet data via TradingView screener. No chart required when symbol is provided.', {
    symbol: z.string().optional().describe('Symbol (e.g. NASDAQ:AAPL). Defaults to current chart symbol.'),
    period: z.enum(['annual', 'quarterly', 'both']).optional().describe('Which periods to return: annual only, quarterly only, or both (default: both)'),
  }, async ({ symbol, period }) => {
    try { return jsonResult(await core.getFinancials({ symbol, period })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_earnings_calendar', 'Get upcoming earnings reporters for a date range, sorted by market cap. Returns consensus EPS and revenue estimates. No chart required.', {
    from: z.string().optional().describe('Start date ISO format (e.g. "2026-05-28"). Defaults to today.'),
    to: z.string().optional().describe('End date ISO format (e.g. "2026-06-04"). Defaults to 7 days from now.'),
    market: z.enum(['america', 'global']).optional().describe('Market to scan (default: america)'),
    limit: z.coerce.number().optional().describe('Max reporters to return (default 100, max 200)'),
  }, async ({ from, to, market, limit }) => {
    try { return jsonResult(await core.getEarningsCalendar({ from, to, market, limit })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_bulk', 'Get fundamentals for 1–50 symbols at once without switching charts. Returns key financial metrics for each symbol. Useful for comparing a watchlist or index members.', {
    symbols: z.array(z.string()).describe('Array of symbols (e.g. ["NASDAQ:AAPL","NASDAQ:MSFT","NYSE:JPM"]). Max 50.'),
    fields: z.array(z.string()).optional().describe('Columns to return. Default: name, close, market_cap_calc, P.EARNINGS, EPS_Diluted_TTM, Revenue_Annual, Revenue_YoY, Net_Income_Margin, Return_on_Equity, earnings_release_date_fq, sector, industry, exchange'),
  }, async ({ symbols, fields }) => {
    try { return jsonResult(await core.getBulk({ symbols, fields })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
