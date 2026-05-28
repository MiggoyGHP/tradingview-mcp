import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerHealthTools } from './tools/health.js';
import { registerChartTools } from './tools/chart.js';
import { registerPineTools } from './tools/pine.js';
import { registerDataTools } from './tools/data.js';
import { registerCaptureTools } from './tools/capture.js';
import { registerDrawingTools } from './tools/drawing.js';
import { registerAlertTools } from './tools/alerts.js';
import { registerBatchTools } from './tools/batch.js';
import { registerReplayTools } from './tools/replay.js';
import { registerIndicatorTools } from './tools/indicators.js';
import { registerWatchlistTools } from './tools/watchlist.js';
import { registerUiTools } from './tools/ui.js';
import { registerPaneTools } from './tools/pane.js';
import { registerTabTools } from './tools/tab.js';

const server = new McpServer(
  {
    name: 'tradingview',
    version: '2.1.0',
    description: 'Market data platform + TradingView chart control via Chrome DevTools Protocol — 83 tools',
  },
  {
    instructions: `TradingView MCP — 83 tools. Primary use: market data. Secondary: chart control.

MARKET DATA (no chart required):
- data_screen → filter entire US/global stock universe by financial criteria (P/E, revenue growth, market cap, sector, etc.)
- data_get_financials → full income statement + balance sheet + cash flow, annual + quarterly, forward estimates
- data_get_earnings_calendar → upcoming earnings reporters with consensus EPS/revenue estimates, sorted by market cap
- data_get_bulk → get fundamentals for 1–50 symbols at once
- data_get_fundamentals → single-symbol FactSet snapshot (P/E, EPS, revenue, margins, growth rates, ratios, estimates)
- data_get_economic_calendar → macro events: CPI, NFP, FOMC, GDP, etc.
- data_get_news → recent news headlines for any symbol
- data_get_holdings → institutional/insider ownership percentages, ETF AUM

READING THE CHART:
- chart_get_state → symbol, timeframe, all indicator names + entity IDs (call first)
- data_get_study_values → current numeric values from ALL visible indicators (RSI, MACD, BB, EMA, etc.)
- quote_get → real-time price snapshot (last, OHLC, volume)
- data_get_ohlcv → price bars (pass summary=true for compact stats; pass symbol= for any ticker)

PINE INDICATOR OUTPUT (line.new/label.new/table.new/box.new):
- data_get_pine_lines → horizontal price levels (deduplicated, sorted)
- data_get_pine_labels → text annotations with prices
- data_get_pine_tables → table data as formatted rows
- data_get_pine_boxes → price zones as {high, low} pairs
- ALWAYS pass study_filter when you know the indicator name

CHANGING THE CHART:
- chart_set_symbol, chart_set_timeframe, chart_set_type → ticker/resolution/style
- chart_manage_indicator → add/remove studies (USE FULL NAMES: "Relative Strength Index" not "RSI")
- chart_scroll_to_date → jump to a date (ISO format)

PINE SCRIPT: pine_set_source → pine_smart_compile → pine_get_errors → pine_get_console
Screenshots: capture_screenshot → "full", "chart", "strategy_tester"
Replay: replay_start → replay_step → replay_trade → replay_status → replay_stop
Batch: batch_run → multi-symbol actions (screenshot, get_ohlcv, get_fundamentals, etc.)
Drawing: draw_shape → horizontal_line, trend_line, rectangle, text
Alerts: alert_create, alert_list, alert_delete
Launch: tv_launch → start TradingView with CDP

CONTEXT MANAGEMENT:
- ALWAYS use summary=true on data_get_ohlcv unless you need individual bars
- ALWAYS use study_filter on pine tools when you know the indicator
- NEVER use verbose=true unless raw data is specifically needed
- Call chart_get_state ONCE, reuse entity IDs`,
  }
);

// Register all tool groups
registerHealthTools(server);
registerChartTools(server);
registerPineTools(server);
registerDataTools(server);
registerCaptureTools(server);
registerDrawingTools(server);
registerAlertTools(server);
registerBatchTools(server);
registerReplayTools(server);
registerIndicatorTools(server);
registerWatchlistTools(server);
registerUiTools(server);
registerPaneTools(server);
registerTabTools(server);

// Startup notice (stderr so it doesn't interfere with MCP stdio protocol)
process.stderr.write('⚠  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n');
process.stderr.write('   Ensure your usage complies with TradingView\'s Terms of Use.\n');
process.stderr.write('   CDP port 9222 has no authentication. Ensure it is bound to localhost only.\n\n');

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
