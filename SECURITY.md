# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Email:** Open a private security advisory via [GitHub Security Advisories](https://github.com/MiggoyGHP/tradingview-mcp/security/advisories/new).

**Do not** open a public issue for security vulnerabilities.

## Scope

This project connects to a locally running TradingView Desktop instance via Chrome DevTools Protocol on `localhost:9222`. Security concerns in scope include:

- Code injection via crafted tool inputs
- Unintended data exposure through tool outputs
- Credential or session token leakage
- Vulnerabilities in the MCP server or CLI that could be exploited locally

## Out of Scope

- TradingView's own security (report to TradingView directly)
- Chrome DevTools Protocol security (report to Google/Chromium)
- Claude Code or MCP SDK security (report to Anthropic)

## Best Practices for Users

- Only run TradingView with `--remote-debugging-port=9222` on localhost
- Do not expose port 9222 to your network or the internet
- Do not pipe `tv stream` output to external services without reviewing the data
- Keep your TradingView Desktop and Node.js installations up to date

## CDP Port Security

The Chrome DevTools Protocol port (default 9222) has **no authentication**.
Any process that can reach this port has full control over the browser page,
including reading cookies, executing JavaScript, and accessing page data.

### Mandatory precautions:
- Launch TradingView with `--remote-debugging-port=9222` only
- **NEVER** use `--remote-debugging-address=0.0.0.0` — this exposes the port to your entire network
- Verify the port is bound to localhost: `netstat -an | grep 9222` should show `127.0.0.1:9222`
- Close the debug port when not in use (restart TradingView without the flag)
- On shared machines, any user's process can connect to this port

### Firewall recommendations:
If you must use the debug port on a shared network, add a firewall rule
to block external access to port 9222:
- **macOS:** `sudo pfctl` or System Preferences > Firewall
- **Windows:** `netsh advfirewall firewall add rule name="Block CDP" dir=in localport=9222 protocol=tcp action=block`
- **Linux:** `sudo iptables -A INPUT -p tcp --dport 9222 -j DROP`

## ui_evaluate Security

The `ui_evaluate` tool executes arbitrary JavaScript in TradingView's Electron page context.
By default, expressions are filtered against a blocklist of dangerous patterns
(e.g., `require()`, `child_process`, `process.env`, `eval()`, `import()`).

Configure via the `TV_MCP_ALLOW_UI_EVALUATE` environment variable:
- `filtered` (default) — blocklist is applied
- `disabled` — the tool is blocked entirely
- `unrestricted` — no filtering (use with caution)

## External Network Requests

The `alert_list` tool is the **only** tool that contacts external servers.
It sends a request to `https://pricealerts.tradingview.com/list_alerts`
using your browser's session cookies. All other tools communicate exclusively
via CDP on localhost:9222.
