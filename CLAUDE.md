# TradingView MCP — Claude Instructions

83 tools. Primary use: **market data**. Secondary: chart control via CDP (port 9222).

## Decision Tree — Which Tool When

### "Screen / filter stocks"
- `data_screen` → filter the entire US or global stock universe by financial/technical criteria. No chart required.
  - Example: `{filters: [{field:"price_earnings_ttm", op:"lt", value:20}, {field:"revenue_change_ttm", op:"gt", value:15}], sort_by:"market_cap_calc"}`
  - **Valid field names** (use these exactly — wrong names cause HTTP 400): `market_cap_calc`, `price_earnings_ttm`, `price_sales`, `enterprise_value_ebitda_ttm`, `revenue_change_ttm` (YoY%), `revenue_change` (QoQ%), `eps_change_ttm`, `return_on_equity`, `gross_margin`, `net_margin`, `debt_to_equity`, `sector`, `industry`, `exchange`, `close`, `total_revenue`, `net_income`, `free_cash_flow_ttm`, `earnings_release_next_date`
  - Operators: `gt` (>), `lt` (<), `eq` (=), `neq` (≠), `between` ([min,max]), `not_between`
- `data_get_bulk` → get current-snapshot fundamentals for a known list of symbols at once (max 50). No chart required. Same field name rules as `data_screen` — invalid names cause HTTP 400.

### "Get historical quarterly series (e.g. past N quarters of revenue / net income / FCF)"
**STOP — the screener API CANNOT do this.** `data_get_financials`, `data_get_bulk`, and `data_screen` all hit `scanner.tradingview.com/scan`, which returns **one snapshot value per metric** (TTM or MRQ). There are no fields for `_fq_2`, `_fq_3`, `revenue_q1_2024`, etc. Inventing such field names → HTTP 400.

**The only way to get multi-quarter historical financial data is Pine Script:**
```pine
//@version=5
indicator("Quarterly Revenue", overlay=false)
rev = request.financial("NASDAQ:NOW", "TOTAL_REVENUE", "FQ")
plot(rev, "Revenue")
```
- Use `request.financial(symbol, "TOTAL_REVENUE", "FQ")` for quarterly revenue
- Use `request.financial(symbol, "NET_INCOME", "FQ")` for quarterly net income
- Use `request.financial(symbol, "FREE_CASH_FLOW", "FQ")` for quarterly FCF
- Pine Script gives access to the full history — run via `pine_set_source` + `pine_smart_compile`

### "Get full financial statements"
- `data_get_financials` → **CURRENT-PERIOD SNAPSHOT ONLY**: TTM income statement + MRQ metrics, balance sheet, cash flow, valuation ratios, margins, returns, liquidity, and forward estimates. No chart required when `symbol` is provided.
  - Returns: `valuation`, `income` (TTM + MRQ keys), `balance`, `cash_flow`, `margins`, `returns`, `liquidity`, `estimates`, `next_earnings_date`
  - **One value per metric, not a time-series.** Cannot return "6 quarters" of anything.

### "Find upcoming earnings"
- `data_get_earnings_calendar` → who's reporting and when, sorted by market cap, with consensus EPS/revenue estimates. No chart required.
  - Different from `data_get_economic_calendar` (which is macro events: CPI, NFP, FOMC, GDP)

### "Get fundamental data for one symbol"
- `data_get_fundamentals` → single-symbol FactSet snapshot: P/E, P/B, EPS, revenue, margins, debt, ROE, ROA, ROCE, quick ratio, D/E, growth rates (YoY/QoQ), forward estimates, dividend yield, earnings date, sector/industry.

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` with `symbol: "NASDAQ:AAPL"` → fetch bars for any ticker (temporarily switches chart then restores)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100, max 500)
- `quote_get` → single latest price snapshot for current chart symbol

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_get_visible_range` → get current visible date range (unix timestamps) and bar count
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)
- `indicator_set_inputs` → change indicator settings (length, source, period, etc.)
- `indicator_toggle_visibility` → show or hide an indicator without removing it
- `symbol_search` → search for symbols by name or keyword
- `symbol_info` → get detailed metadata for the current symbol (exchange, type, description)

### "Work on Pine Script"
1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check (auto-dismisses "Save Script" dialog)
3. `pine_get_errors` → read compilation errors
4. `pine_get_console` → read **compile-time** messages only (syntax errors, "Compiled. Added to chart."). **Does NOT reliably return runtime `log.info()` output** — use `table.new()` + `data_get_pine_tables` for runtime data instead.
5. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → create blank indicator/strategy/library
8. `pine_open` → load a saved script by name
9. `pine_list_scripts` → list all saved Pine scripts
10. `pine_analyze` → static analysis WITHOUT compiling — catches array OOB, bad loop bounds, implicit bool casts (no chart connection needed)
11. `pine_check` → server-side compile check via TradingView API without chart open — validates syntax/errors before injecting
12. `pine_compile` → direct compile/add to chart (use `pine_smart_compile` for auto-detection)

### Pine Script v6 Gotchas (learned the hard way)

**`max_tables` removed**: Don't pass `max_tables=N` to `indicator()` — that argument was removed in Pine Script v6. Drop it entirely.
```pine
// BAD — v6 compile error
indicator("My Script", max_tables=1)
// GOOD
indicator("My Script")
```

**Newlines terminate statements**: A function call broken across lines causes `"end of line without line continuation"`. Build multi-part strings into a variable first, then pass the variable.
```pine
// BAD — newline inside log.info() causes parse error
log.info("value: " + str.tostring(v1)
         + " other: " + str.tostring(v2))
// GOOD — build first, then call
msg = "value: " + str.tostring(v1) + " other: " + str.tostring(v2)
log.info(msg)
```

**Ternary can't return arrays**: The ternary `?:` operator does not support `array<float>` (or any array type) as a return value. Use separate if/else blocks or inline 5 separate code sections per symbol.
```pine
// BAD — compile error (ternary returning float[])
arr = cond ? arr_a : arr_b
// GOOD — use separate blocks
if cond
    process(arr_a)
else
    process(arr_b)
```

**`log.info()` output is not readable via MCP**: `pine_get_console` reads the Pine Editor DOM, not the runtime log panel. Use `table.new()` to write output to the chart and read it with `data_get_pine_tables`.

**`data_get_pine_tables` needs time after compile**: Scripts using `request.financial()` make multiple async requests. `barstate.islast` (which triggers table rendering) only fires after all requests resolve — this can take 5–15 seconds. Pass `retries: 3, retry_delay_ms: 5000` to auto-wait:
```
data_get_pine_tables { study_filter: "My Script", retries: 3, retry_delay_ms: 5000 }
```

**Script slot renaming**: If the Pine Editor had a different script open (e.g. "Clock_RUT"), saving your new code under a new name reassigns that chart study slot to the old script's name. Fix: after `pine_smart_compile`, call `chart_get_state` to verify your indicator's actual entity ID before reading its output.

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Get fundamental, news, or market depth data"
- `data_get_fundamentals` → P/E, EPS, revenue, margins, debt, earnings date, sector (US stocks + PSX: prefix for Philippine stocks)
- `data_get_news` → recent news headlines for the current symbol
- `data_get_economic_calendar` → upcoming events: CPI, NFP, FOMC, GDP, etc. (filter by country, date range, impact level)
- `data_get_holdings` → institutional/insider ownership %; ETF AUM
- `depth_get` → order book / DOM (Depth of Market) data

### "Analyze strategy results"
- `data_get_strategy_results` → performance metrics from Strategy Tester (net profit, win rate, max DD, etc.)
- `data_get_trades` → full trade list from Strategy Tester (up to 20 per request)
- `data_get_equity` → equity curve data from Strategy Tester

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_get_properties` → get coordinates and properties of a specific drawing by entity ID
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `ui_hover` → hover over an element (triggers tooltips/dropdowns)
- `ui_keyboard` → press keyboard shortcuts (e.g., "Alt+S", "Ctrl+Z", "Escape")
- `ui_type_text` → type text into the focused input/textarea
- `ui_scroll` → scroll the chart or page up/down/left/right
- `ui_mouse_click` → click at specific x,y pixel coordinates
- `ui_find_element` → find elements by text, aria-label, or CSS selector and return positions
- `layout_list` → list all saved chart layouts
- `layout_switch` → load a saved layout by name or ID
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "Manage tabs"
- `tab_list` → list all open chart tabs
- `tab_new` → open a new chart tab
- `tab_switch` → switch to a tab by index
- `tab_close` → close the current tab

### "Manage panes"
- `pane_list` → list all panes in the current layout with their symbols
- `pane_focus` → focus a specific pane by index (0-based)
- `pane_set_layout` → change the grid layout (e.g., single, 2h, 2v, 2x2, 3v)
- `pane_set_symbol` → set the symbol on a specific pane by index

### "Manage watchlist"
- `watchlist_get` → get all symbols from the current watchlist with price, change, change%
- `watchlist_add` → add a symbol to the watchlist

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working
- `tv_discover` → report which TradingView API paths are available (useful after TV updates)
- `tv_ui_state` → snapshot of open panels, visible buttons, chart state, and replay status
- `tv_dismiss_dialogs` → dismiss blocking TradingView modals ("Continue your last replay?", "Leave current replay?") that silently stall chart ops — safe to call any time
- **Standalone launcher** (Windows, no MCP needed): `.\launch-tradingview.ps1` at project root — kills existing TV, launches via COM activation (Windows Store) or direct spawn (classic installer), polls until CDP is ready, prints green/red status

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`

## Security Controls

- `ui_evaluate` is filtered by default — see `src/security/evaluate-filter.js`
  - Set `TV_MCP_ALLOW_UI_EVALUATE=disabled` to block it entirely
  - Set `TV_MCP_ALLOW_UI_EVALUATE=unrestricted` to bypass filtering (not recommended)
- `alert_list` is the **only** tool that contacts external servers (`pricealerts.tradingview.com`)
- CDP port 9222 must remain localhost-only — see `SECURITY.md` for details
- Dependencies are pinned to exact versions (no `^` ranges) — see `package.json`
- All string inputs sanitized via `safeString()` before CDP evaluation
- All numeric inputs validated via `requireFinite()` before use
