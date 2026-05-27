import { getClient } from '../connection.js';

/**
 * Enable CDP Network monitoring, call triggerFn(), resolve with the first response whose
 * URL contains urlFragment and whose body is valid JSON.
 *
 * @param {string}   urlFragment - Substring to match against response URLs
 * @param {Function} triggerFn   - Async fn that causes TradingView to make the network request
 * @param {number}   timeout     - Max wait time ms (default 12000)
 * @returns {{ url: string, data: any }}
 */
export async function captureNetworkResponse(urlFragment, triggerFn, timeout = 12000) {
  const c = await getClient();
  await c.Network.enable();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      c.removeListener('Network.requestWillBeSent', onRequest);
      c.removeListener('Network.responseReceived', onResponse);
      reject(new Error(`Network capture timeout: no JSON response matching "${urlFragment}" within ${timeout}ms`));
    }, timeout);

    const pending = new Map(); // requestId -> url

    function onRequest(params) {
      if (params.request && params.request.url && params.request.url.includes(urlFragment)) {
        pending.set(params.requestId, params.request.url);
      }
    }

    async function onResponse(params) {
      if (!pending.has(params.requestId)) return;
      const url = pending.get(params.requestId);
      pending.delete(params.requestId);
      try {
        const { body } = await c.Network.getResponseBody({ requestId: params.requestId });
        const data = JSON.parse(body);
        clearTimeout(timer);
        c.removeListener('Network.requestWillBeSent', onRequest);
        c.removeListener('Network.responseReceived', onResponse);
        resolve({ url, data });
      } catch { /* non-JSON response, keep waiting */ }
    }

    c.on('Network.requestWillBeSent', onRequest);
    c.on('Network.responseReceived', onResponse);

    if (triggerFn) Promise.resolve(triggerFn()).catch(reject);
  });
}

/**
 * Capture up to `count` matching JSON responses. Resolves early once count is met,
 * or returns whatever was captured at timeout.
 *
 * @param {string}   urlFragment
 * @param {Function} triggerFn
 * @param {number}   count   - Number of responses to collect (default 3)
 * @param {number}   timeout
 * @returns {Array<{ url: string, data: any }>}
 */
export async function captureAllNetworkResponses(urlFragment, triggerFn, count = 3, timeout = 15000) {
  const c = await getClient();
  await c.Network.enable();

  return new Promise((resolve) => {
    const results = [];
    const pending = new Map();

    const timer = setTimeout(() => {
      c.removeListener('Network.requestWillBeSent', onRequest);
      c.removeListener('Network.responseReceived', onResponse);
      resolve(results);
    }, timeout);

    function cleanup() {
      clearTimeout(timer);
      c.removeListener('Network.requestWillBeSent', onRequest);
      c.removeListener('Network.responseReceived', onResponse);
    }

    function onRequest(params) {
      if (params.request && params.request.url && params.request.url.includes(urlFragment)) {
        pending.set(params.requestId, params.request.url);
      }
    }

    async function onResponse(params) {
      if (!pending.has(params.requestId)) return;
      const url = pending.get(params.requestId);
      pending.delete(params.requestId);
      try {
        const { body } = await c.Network.getResponseBody({ requestId: params.requestId });
        const data = JSON.parse(body);
        results.push({ url, data });
        if (results.length >= count) { cleanup(); resolve(results); }
      } catch { /* skip non-JSON */ }
    }

    c.on('Network.requestWillBeSent', onRequest);
    c.on('Network.responseReceived', onResponse);

    if (triggerFn) Promise.resolve(triggerFn()).catch(() => { cleanup(); resolve(results); });
  });
}

/**
 * Disable CDP Network monitoring. Call after a capture session to reduce overhead.
 */
export async function disableNetworkMonitoring() {
  try {
    const c = await getClient();
    await c.Network.disable();
  } catch { /* ignore */ }
}
