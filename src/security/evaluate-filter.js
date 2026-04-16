/**
 * Security filter for ui_evaluate expressions.
 *
 * Blocks patterns that could escalate from renderer JS to Node.js/OS access
 * in Electron environments where nodeIntegration or CDP bridges are present.
 *
 * Modes (TV_MCP_ALLOW_UI_EVALUATE env var):
 *   "disabled"     — ui_evaluate is blocked entirely
 *   "filtered"     — blocklist is applied (default)
 *   "unrestricted" — no filtering, logs a warning
 */

export const BLOCKED_PATTERNS = [
  { pattern: /require\s*\(/i, reason: 'Node.js require() call' },
  { pattern: /child_process/i, reason: 'child_process module access' },
  { pattern: /\bprocess\.env\b/i, reason: 'environment variable access' },
  { pattern: /\bprocess\.exit\b/i, reason: 'process termination' },
  { pattern: /\b__dirname\b/, reason: '__dirname path disclosure' },
  { pattern: /\b__filename\b/, reason: '__filename path disclosure' },
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/i, reason: 'filesystem module import' },
  { pattern: /require\s*\(\s*['"]net['"]\s*\)/i, reason: 'network module import' },
  { pattern: /require\s*\(\s*['"]http['"]\s*\)/i, reason: 'HTTP module import' },
  { pattern: /require\s*\(\s*['"]https['"]\s*\)/i, reason: 'HTTPS module import' },
  { pattern: /require\s*\(\s*['"]os['"]\s*\)/i, reason: 'OS module import' },
  { pattern: /\.exec\s*\(/i, reason: 'command execution (.exec)' },
  { pattern: /\.spawn\s*\(/i, reason: 'process spawning (.spawn)' },
  { pattern: /\.execSync\s*\(/i, reason: 'synchronous command execution' },
  { pattern: /\.spawnSync\s*\(/i, reason: 'synchronous process spawning' },
  { pattern: /\beval\s*\(/i, reason: 'nested eval() call' },
  { pattern: /\bnew\s+Function\s*\(/i, reason: 'Function constructor (eval equivalent)' },
  { pattern: /\bimport\s*\(/i, reason: 'dynamic import()' },
  { pattern: /globalThis\.process/i, reason: 'globalThis.process access' },
  { pattern: /\bprocess\.binding\b/i, reason: 'process.binding access' },
  { pattern: /\bprocess\.dlopen\b/i, reason: 'process.dlopen access' },
];

/**
 * Read the evaluate mode from TV_MCP_ALLOW_UI_EVALUATE env var.
 * @returns {"disabled"|"filtered"|"unrestricted"}
 */
export function getEvaluateMode() {
  const mode = (process.env.TV_MCP_ALLOW_UI_EVALUATE || 'filtered').toLowerCase();
  if (mode === 'disabled' || mode === 'unrestricted') return mode;
  return 'filtered';
}

/**
 * Validate an expression against the blocklist.
 * Throws an Error if any blocked pattern is matched.
 * @param {string} expression
 */
export function validateExpression(expression) {
  if (typeof expression !== 'string') {
    throw new Error('ui_evaluate expression must be a string');
  }

  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(expression)) {
      throw new Error(
        `ui_evaluate blocked: expression matches dangerous pattern (${reason}). ` +
        'If you need unrestricted access, set TV_MCP_ALLOW_UI_EVALUATE=unrestricted.'
      );
    }
  }
}
