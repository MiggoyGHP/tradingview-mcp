---
name: stock-compare
description: |
  Compare fundamental metrics side-by-side for a list of stocks using a single data_get_bulk call.
  Use this skill when the user asks for things like:
  - "compare these stocks: NOW, CRM, TEAM..."
  - "show me fundamentals for $NOW, $CRM, $WDAY"
  - "side-by-side comparison"
  - "which of these has the best margins / growth / P/E"
  - "give me the key metrics for [list of symbols]"
  
  This skill uses data_get_bulk with hardcoded valid field names to avoid the HTTP 400
  errors that occur when Claude improvises field names like "P.EARNINGS" or "Revenue_Annual".
---

# Stock Compare

Fetches current-period fundamental snapshots for multiple symbols in one call and
presents a structured comparison. These are TTM/MRQ values — not historical series.
For multi-quarter history, use the `quarterly-history` skill instead.

## Workflow

**Step 1 — Parse symbols**
Strip `$` prefix. Add exchange prefix if missing:
- Default `NASDAQ:` for common US tech: NOW, AAPL, MSFT, GOOGL, NVDA, META, AMZN, ADBE, TEAM, WDAY
- Use `NYSE:` for: CRM, SNOW, IBM, ORCL, DELL
- When unsure, use `NASDAQ:` — the screener API resolves both for most US stocks

Examples: `$NOW` → `NASDAQ:NOW`, `$CRM` → `NYSE:CRM`, `$SNOW` → `NYSE:SNOW`

**Step 2 — Call `data_get_bulk`**

Always use this exact fields list (these are the only validated valid names):

```json
{
  "symbols": ["NASDAQ:NOW", "NYSE:CRM", "NASDAQ:TEAM", "NYSE:SNOW", "NASDAQ:WDAY"],
  "fields": [
    "name",
    "close",
    "market_cap_calc",
    "price_earnings_ttm",
    "price_sales",
    "revenue_change_ttm",
    "revenue_change",
    "net_margin",
    "gross_margin",
    "free_cash_flow_ttm",
    "return_on_equity",
    "debt_to_equity",
    "earnings_release_next_date",
    "sector"
  ]
}
```

**Do not** pass field names like `P.EARNINGS`, `Revenue_YoY`, `EV_EBITDA`, `Revenue_Annual`,
`EPS_Diluted_TTM`, or any camelCase/PascalCase variants — these cause HTTP 400.

**Step 3 — Present as comparison table**

| Symbol | Price | Mkt Cap | P/E | P/S | Rev YoY% | Rev QoQ% | Net Margin | Gross Margin | FCF (TTM) | ROE | D/E | Next Earnings |
|--------|-------|---------|-----|-----|----------|----------|------------|--------------|-----------|-----|-----|---------------|
| NOW    | ...   | ...     | ... | ... | ...      | ...      | ...        | ...          | ...       | ... | ... | ...           |
| CRM    | ...   | ...     | ... | ... | ...      | ...      | ...        | ...          | ...       | ... | ... | ...           |

Format numbers:
- Market cap: abbreviate (e.g., 45.2B, 180.4B)
- FCF: abbreviate in millions (e.g., 2,340M)
- Percentages: 1 decimal place with % sign
- P/E, P/S: 1 decimal place

**Step 4 — Commentary**
After the table, add 2–4 sentences highlighting:
- Who has the highest revenue growth (YoY and QoQ)
- Who has the best profitability (net margin, FCF)
- Valuation comparison (cheapest/most expensive on P/E and P/S)
- Anything notable (e.g., negative margins, high debt, upcoming earnings catalyst)

## Requesting Additional Metrics

If the user asks for metrics not in the default fields list, add them from this validated set only:

| Metric | Field name |
|--------|-----------|
| EPS (TTM) | `earnings_per_share_diluted_ttm` |
| Net income (TTM) | `net_income` |
| Total revenue (TTM) | `total_revenue` |
| Operating margin | `operating_margin` |
| Current ratio | `current_ratio` |
| Quick ratio | `quick_ratio` |
| Total debt | `total_debt` |
| Return on assets | `return_on_assets` |
| EV/EBITDA | `enterprise_value_ebitda_ttm` |
| Dividend yield | `dividend_yield_calc` |
| Next earnings date | `earnings_release_next_date` |

## Limitations

- These are **current snapshot values** (TTM = trailing 12 months, MRQ = most recent quarter)
- For historical quarterly series: use `quarterly-history` skill
- Max 50 symbols per call
- Global stocks: use `global` market in data_screen; for Philippine stocks prefix `PSX:`

## See Also
- `quarterly-history` skill — multi-quarter revenue/NI/FCF history via Pine Script
- `chart-analysis` skill — current chart state, indicators, price levels
