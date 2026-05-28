---
name: chart-analysis
description: |
  Run a full analysis of the current TradingView chart in one shot.
  Use this skill when the user asks for things like:
  - "analyze my chart"
  - "give me a full chart report"
  - "what's on my chart right now"
  - "full analysis"
  - "chart report"
  - "what do you see on the chart"
---

# Chart Analysis

Runs the complete 7-tool sequence to produce a structured chart report. Call all tools
in order — do not skip steps, as each contributes a distinct section of the report.

## Workflow (run in this exact order)

**1. `quote_get`**
Current price, OHLC, volume. Establishes the symbol and session context.

**2. `data_get_study_values`**
All visible indicator readings: RSI, MACD, Bollinger Bands, EMAs, custom plots.
Captures numeric values from every study currently on the chart.

**3. `data_get_pine_lines`**
Horizontal price levels drawn by Pine Script indicators (line.new).
These are support/resistance levels, pivots, VWAP bands, etc.

**4. `data_get_pine_labels`**
Text annotations with prices (label.new): PDH, PDL, settlements, session opens,
bias labels (e.g., "Bias Long ✓"), named price references.

**5. `data_get_pine_tables`**
Session stats and dashboard tables rendered by indicators (table.new):
position data, cumulative delta, session analytics, etc.

**6. `data_get_ohlcv` with `summary: true`**
Compact price action summary: session high/low/range, change%, avg volume, last 5 bars.

**7. `capture_screenshot`**
Visual snapshot of the current chart state. Include the file path in the report.

## Output Format

Present as a structured markdown report:

---
**[SYMBOL] — [TIMEFRAME] Chart Analysis**

**Price:** [last] ([change]%) | O: [open] H: [high] L: [low] V: [volume]

**Key Levels** *(from Pine indicators)*
- [level] — [label if available]
- ...

**Indicator Readings**
- RSI: [value] ([overbought/oversold/neutral])
- MACD: [signal status]
- [others as present]

**Session / Indicator Data** *(from tables)*
- [formatted table rows]

**Price Action Summary**
Range: [range] | Change: [pct]% | Avg Vol: [vol]
Last 5 bars: [brief summary]

**Screenshot:** [path]
---

## Context Rules

- `data_get_pine_lines` and `data_get_pine_labels` are only meaningful if custom Pine
  indicators are on the chart. If they return 0 studies, note that no custom Pine
  indicators are active and skip those sections.
- If `data_get_pine_tables` returns nothing, skip the Session/Indicator Data section.
- Always include the screenshot — it provides visual context the data alone cannot.
- Do not add `study_filter` to any call here — collect everything from all indicators.

## See Also
- `quarterly-history` skill — for historical quarterly financial data
- `stock-compare` skill — for multi-symbol fundamental comparison
