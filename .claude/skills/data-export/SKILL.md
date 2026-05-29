---
name: data-export
description: |
  Export HISTORICAL market data to files (JSON + CSV in data_exports/) so it can feed
  dashboards and other projects. Use this skill whenever the user asks to:
  - "export OHLCV / price history for AAPL, MSFT, NVDA to CSV"
  - "save the chart data with RSI and MACD to a file"
  - "dump 6 quarters of revenue for NOW and CRM to JSON"
  - "get historical indicator data I can load into a dashboard"
  - Any request to PERSIST historical price, index, indicator, or fundamental data as files

  Two engines:
  - data_export_chart → TradingView's native "Download chart data" CSV = time + OHLCV +
    EVERY visible indicator's full per-bar history (UNIX timestamps), aligned by bar.
  - data_export_fundamentals → multi-quarter financials via Pine request.financial().
---

# Data Export

Persists historical data to timestamped JSON + CSV files in `data_exports/` (or a caller
`out_dir`). Tools return absolute file paths a dashboard can read/watch.

## Which tool

| Want | Tool |
|------|------|
| Price / index OHLCV (any symbol/timeframe) | `data_export_chart` |
| OHLCV **+ indicator history** (RSI, MACD, EMA, …) | `data_export_chart` with `indicators` |
| Multi-quarter revenue / net income / FCF / EPS | `data_export_fundamentals` |

## Workflow — price + indicators (`data_export_chart`)

1. Decide the symbol, timeframe, and which indicators the user wants as columns.
2. Call once per symbol:
   ```
   data_export_chart {
     symbol: "NASDAQ:AAPL",
     timeframe: "D",
     indicators: ["Relative Strength Index", "MACD"],
     formats: ["json","csv"]
   }
   ```
3. Report the returned `csv_path` / `json_path`, `row_count`, and `columns`.

**How it works:** the default `native` engine drives TradingView's "Download chart data"
menu. The CSV contains time + OHLCV + every indicator currently **visible** on the chart.
If the native download can't be captured it auto-falls back to a fast **price-only** API
export (`engine: "api"`, `note` set) — surface that so the user knows indicators were dropped.

### Gotchas
- **Indicators must be visible on the chart to appear as columns.** Pass `indicators` (FULL
  names — "Relative Strength Index", not "RSI") to add them first.
- TradingView emits **duplicate column headers** (several `EMA`, `Plot`, `Shapes`); the JSON
  uniquifies them (`EMA`, `EMA_1`, `EMA_2`). This is expected.
- Time is a **UNIX timestamp** (seconds).
- Native export includes all *loaded* bars; the `count` param only bounds the API fallback.
- Multi-symbol batch: loop `data_export_chart` per symbol (it switches the chart each time).

## Workflow — fundamentals (`data_export_fundamentals`)

```
data_export_fundamentals {
  symbols: ["NASDAQ:NOW","NYSE:CRM"],
  metrics: ["revenue","net_income","fcf"],
  quarters: 6
}
```
- Symbols **must include an exchange prefix** (`NASDAQ:`, `NYSE:`). Use `symbol_search` if unsure.
- Output is **long-form** rows `{symbol, metric, period, value}` — the dashboard-friendly shape
  (one row per symbol×metric×quarter). Values are as-reported (e.g. USD).
- This compiles a Pine indicator and reads it back, so it takes several seconds. If it returns
  "No table output", re-run (request.financial resolves asynchronously) or check the exchange prefix.

## See Also
- `quarterly-history` skill — same fundamentals data presented as an inline markdown table (no file).
- `chart-analysis` skill — read current chart state without exporting.
