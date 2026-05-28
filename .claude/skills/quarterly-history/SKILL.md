---
name: quarterly-history
description: |
  Get multi-quarter historical financial data (revenue, net income, FCF) for one or more stocks.
  Use this skill whenever the user asks for things like:
  - "past N quarters of revenue / net income / FCF"
  - "quarterly revenue history for NOW, CRM, TEAM..."
  - "show me 6 quarters of financials"
  - "revenue growth over the last 4 quarters"
  - Any request involving historical quarterly series for financial metrics
  
  IMPORTANT: The screener API (data_get_financials, data_get_bulk, data_screen) returns
  ONE snapshot value per metric — it CANNOT return time-series data. This skill uses
  Pine Script request.financial() which CAN return multi-quarter history. Attempting to
  get this data via the screener causes HTTP 400 errors.
---

# Quarterly History

Fetches multi-quarter financial data by generating and running a Pine Script indicator
that uses `request.financial()` — the only way to get historical quarterly series from TradingView.

## Workflow

**Step 1 — Parse the request**
- Symbols: strip `$` prefix, add exchange if missing (default `NASDAQ:` for US tech names)
  - `$NOW` → `NASDAQ:NOW`, `$CRM` → `NYSE:CRM`, `$TEAM` → `NASDAQ:TEAM`
  - `$SNOW` → `NYSE:SNOW`, `$WDAY` → `NASDAQ:WDAY`
- Metric: map to Pine key
  - `revenue` → `"TOTAL_REVENUE"`
  - `net_income` → `"NET_INCOME"`
  - `fcf` / `free cash flow` → `"FREE_CASH_FLOW"`
  - `gross_profit` → `"GROSS_PROFIT"`
  - `ebitda` → `"EBITDA"`
  - `eps` → `"EARNINGS_PER_SHARE_DILUTED"`
- Quarters N: default 6, max 8 (Pine history lookback limit in practice)
- Multiple metrics: generate one table per metric, or a combined indicator

**Step 2 — Generate the Pine Script**

Build the script dynamically. For M symbols and N quarters:

```pine
//@version=5
indicator("Quarterly History", overlay=false, max_bars_back=500)

// Retrieve quarterly data for each symbol
sym1_data = request.financial("EXCHANGE:SYM1", "METRIC_KEY", "FQ")
sym2_data = request.financial("EXCHANGE:SYM2", "METRIC_KEY", "FQ")
// ... one line per symbol

// Build display table: cols = Q-(N-1) ... Q0, rows = header + one per symbol
var table t = table.new(position.top_right, N + 1, M + 1,
     border_width = 1, border_color = color.gray,
     bgcolor = color.new(color.black, 85))

if barstate.islastconfirmedhistory
    // Header row
    table.cell(t, 0, 0, "Symbol",  bgcolor=color.gray, text_color=color.white, text_size=size.small)
    for q = 0 to N - 1
        table.cell(t, q + 1, 0, "Q-" + str.tostring(N - 1 - q),
             bgcolor=color.gray, text_color=color.white, text_size=size.small)
    
    // Symbol rows — divide by 1e6 and round for readability
    table.cell(t, 0, 1, "SYM1", text_color=color.white, text_size=size.small)
    for q = 0 to N - 1
        val = sym1_data[N - 1 - q]
        table.cell(t, q + 1, 1, str.tostring(math.round(val / 1e6, 1)) + "M",
             text_color = val > 0 ? color.green : color.red, text_size=size.small)
    // ... repeat for each symbol
```

**Step 3 — Inject and compile**
```
pine_set_source   ← the generated script
pine_smart_compile
```
Wait for compile. If `has_errors: true` in the result, call `pine_get_errors` and fix before proceeding.

**Step 4 — Read the table output**
```
data_get_pine_tables   (study_filter: "Quarterly History")
```

**Step 5 — Present results**
Convert the raw table rows into a clean markdown table:

| Symbol | Q-5 | Q-4 | Q-3 | Q-2 | Q-1 | Q0 |
|--------|-----|-----|-----|-----|-----|----|
| NOW    | ... | ... | ... | ... | ... | ...|
| CRM    | ... | ... | ... | ... | ... | ...|

Add a brief commentary: QoQ trend, which symbol is growing fastest, any deceleration.

## Multiple Metrics

If the user asks for 2–3 metrics at once (e.g., revenue + net income + FCF), generate a single
Pine Script with multiple tables (one per metric, stacked vertically using different table positions:
`position.top_right`, `position.middle_right`, `position.bottom_right`).

## Exchange Lookup Reference

Common US tech stocks and their exchanges:
- NASDAQ: NOW, AAPL, MSFT, GOOGL, META, NVDA, AMZN, TSLA, TEAM, WDAY, SNOW, ADBE, CRM (wait — CRM is NYSE)
- NYSE: CRM, SNOW, WDAY, IBM, ORCL, DELL, HPQ

When unsure, use `symbol_search` to resolve, or default to `NASDAQ:` and let Pine compile errors surface the correct exchange.

## See Also
- `stock-compare` skill — for current-period snapshot comparisons (no historical series)
- `chart-analysis` skill — for reading current chart state and indicators
