import { evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 100;

// Some TradingView modals block chart updates and trap subsequent calls in a
// silent stall. Known blockers (as of TV Desktop 3.1.0):
//   1. "Continue your last replay?" — appears on app startup if a prior session
//      left replay state. Dismiss with "Start new" for a clean chart.
//   2. "Leave current replay?" — appears when a chart op (setSymbol/setResolution)
//      runs while replay is active. Dismiss with "Leave" and uncheck
//      "Save this replay" so #1 doesn't fire on the next launch.
// Returns the actions taken so callers can log or surface them.
export async function dismissBlockingDialogs() {
  return evaluate(`
    (function() {
      var actions = [];
      function findDialogContaining(text) {
        var headings = document.querySelectorAll('h1, h2, h3, [class*="title"], [class*="heading"]');
        for (var i = 0; i < headings.length; i++) {
          var h = headings[i];
          if (!text.test(h.textContent || '')) continue;
          if (h.offsetParent === null) continue;
          var c = h;
          for (var d = 0; d < 12 && c; d++) {
            if (/dialog/i.test(c.className || '')) return c;
            c = c.parentElement;
          }
        }
        return null;
      }
      function clickButton(container, label) {
        var btns = container.querySelectorAll('button');
        for (var j = 0; j < btns.length; j++) {
          if (label.test((btns[j].textContent || '').trim())) {
            btns[j].click();
            return true;
          }
        }
        return false;
      }
      // 1. "Continue your last replay?" — choose "Start new"
      var c1 = findDialogContaining(/continue your last replay/i);
      if (c1 && clickButton(c1, /^Start new$/i)) {
        actions.push('dismissed_continue_last_replay');
      }
      // 2. "Leave current replay?" — uncheck save, then "Leave"
      var c2 = findDialogContaining(/leave current replay/i);
      if (c2) {
        var cbs = c2.querySelectorAll('input[type="checkbox"]');
        for (var k = 0; k < cbs.length; k++) {
          if (cbs[k].checked) cbs[k].click();
        }
        if (clickButton(c2, /^Leave$/i)) {
          actions.push('dismissed_leave_current_replay');
        }
      }
      return { actions: actions };
    })()
  `);
}

// Poll the chart's real API — chart.symbol(), chart.resolution(), and
// mainSeries().bars().size() — instead of DOM bar elements. DOM polling is
// brittle: bar elements don't always stabilize (intraday symbols have a
// moving last-bar) and "title" selectors break across TradingView UI updates.
export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  // Proactively dismiss any modal that would block the operation we just
  // triggered. Cheap (one CDP round-trip) and unblocks the common case where
  // a prior session left replay state behind.
  try { await dismissBlockingDialogs(); } catch { /* best-effort */ }

  const start = Date.now();
  let lastBarCount = -1;
  let stableCount = 0;
  let dismissAttempts = 0;

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        try {
          var chart = window.TradingViewApi._activeChartWidgetWV.value();
          var bars = chart._chartWidget.model().mainSeries().bars();
          return {
            symbol: chart.symbol(),
            resolution: chart.resolution(),
            barCount: bars.size(),
            // status 1 = ready, 2 = loading, others vary; use isLoading() if present
            seriesStatus: typeof chart._chartWidget.model().mainSeries().status === 'function'
              ? chart._chartWidget.model().mainSeries().status() : null,
          };
        } catch (e) {
          return { error: String(e) };
        }
      })()
    `);

    if (!state || state.error) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Wait for the symbol switch to propagate.
    if (expectedSymbol) {
      const want = expectedSymbol.toUpperCase();
      const got = String(state.symbol || '').toUpperCase();
      // Compare bare tickers (strip exchange prefix from both sides).
      // Substring matching in either direction produces false positives:
      // e.g. want="BTCUSDT", got="BINANCE:BTC" → "BTCUSDT".includes("BTC")=true
      // but the symbols are different. Exact comparison of bare tickers is correct.
      const wantTicker = want.includes(':') ? want.split(':').pop() : want;
      const gotTicker = got.includes(':') ? got.split(':').pop() : got;
      if (gotTicker !== wantTicker && got !== want) {
        stableCount = 0;
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        continue;
      }
    }
    if (expectedTf) {
      if (String(state.resolution) !== String(expectedTf)) {
        stableCount = 0;
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        continue;
      }
    }

    // Readiness:
    //   - if expectedSymbol/expectedTf was given, we already matched it above;
    //   - the chart has at least some bars loaded.
    // We don't require bar-count stability because intraday timeframes have a
    // last-bar that ticks constantly (count jitters by ±1 every poll).
    if (state.barCount > 0 && (expectedSymbol || expectedTf)) {
      return true;
    }
    // Without an expected target, fall back to a 2-poll stable-bar-count check
    // (still useful for "wait for chart to be ready at all" scenarios).
    if (state.barCount > 0 && state.barCount === lastBarCount) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastBarCount = state.barCount;
    if (stableCount >= 2 && state.barCount > 0) return true;

    // If we've been idle a while (no bars showing up), the chart might be
    // blocked by a modal that appeared after we started waiting. Retry the
    // dismiss once at ~3s in.
    if (state.barCount === 0 && dismissAttempts === 0 && Date.now() - start > 3000) {
      dismissAttempts++;
      try { await dismissBlockingDialogs(); } catch { /* best-effort */ }
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout — return false so callers can surface chart_ready=false.
  return false;
}
