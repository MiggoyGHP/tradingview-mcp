import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateExpression, getEvaluateMode, BLOCKED_PATTERNS } from '../src/security/evaluate-filter.js';

describe('evaluate-filter — blocked patterns', () => {
  it('blocks require() calls', () => {
    assert.throws(() => validateExpression("require('child_process')"), /blocked/);
    assert.throws(() => validateExpression("require ('fs')"), /blocked/);
    assert.throws(() => validateExpression("const m = require('os')"), /blocked/);
  });

  it('blocks child_process references', () => {
    assert.throws(() => validateExpression("child_process.exec('ls')"), /blocked/);
    assert.throws(() => validateExpression("const cp = child_process"), /blocked/);
  });

  it('blocks process.env access', () => {
    assert.throws(() => validateExpression("process.env.SECRET"), /blocked/);
    assert.throws(() => validateExpression("console.log(process.env)"), /blocked/);
  });

  it('blocks process.exit', () => {
    assert.throws(() => validateExpression("process.exit(1)"), /blocked/);
  });

  it('blocks __dirname and __filename', () => {
    assert.throws(() => validateExpression("console.log(__dirname)"), /blocked/);
    assert.throws(() => validateExpression("fs.readFile(__filename)"), /blocked/);
  });

  it('blocks fs module import', () => {
    assert.throws(() => validateExpression("require('fs')"), /blocked/);
    assert.throws(() => validateExpression("require( 'fs' )"), /blocked/);
  });

  it('blocks net and http module imports', () => {
    assert.throws(() => validateExpression("require('net')"), /blocked/);
    assert.throws(() => validateExpression("require('http')"), /blocked/);
    assert.throws(() => validateExpression("require('https')"), /blocked/);
  });

  it('blocks os module import', () => {
    assert.throws(() => validateExpression("require('os')"), /blocked/);
  });

  it('blocks .exec() and .spawn()', () => {
    assert.throws(() => validateExpression("cp.exec('ls')"), /blocked/);
    assert.throws(() => validateExpression("cp.spawn('sh')"), /blocked/);
    assert.throws(() => validateExpression("cp.execSync('whoami')"), /blocked/);
    assert.throws(() => validateExpression("cp.spawnSync('node')"), /blocked/);
  });

  it('blocks eval()', () => {
    assert.throws(() => validateExpression("eval('alert(1)')"), /blocked/);
  });

  it('blocks new Function()', () => {
    assert.throws(() => validateExpression("new Function('return 1')"), /blocked/);
  });

  it('blocks dynamic import()', () => {
    assert.throws(() => validateExpression("import('fs')"), /blocked/);
    assert.throws(() => validateExpression("import ('os')"), /blocked/);
  });

  it('blocks globalThis.process', () => {
    assert.throws(() => validateExpression("globalThis.process.env.TOKEN"), /blocked/);
  });

  it('blocks process.binding and process.dlopen', () => {
    assert.throws(() => validateExpression("process.binding('fs')"), /blocked/);
    assert.throws(() => validateExpression("process.dlopen(module, '/tmp/lib.so')"), /blocked/);
  });
});

describe('evaluate-filter — allowed expressions', () => {
  it('allows document.title', () => {
    assert.doesNotThrow(() => validateExpression('document.title'));
  });

  it('allows window.innerWidth', () => {
    assert.doesNotThrow(() => validateExpression('window.innerWidth'));
  });

  it('allows simple arithmetic', () => {
    assert.doesNotThrow(() => validateExpression('1 + 1'));
  });

  it('allows DOM queries', () => {
    assert.doesNotThrow(() => validateExpression("document.querySelector('.chart')"));
  });

  it('allows fetch to localhost', () => {
    assert.doesNotThrow(() => validateExpression("fetch('http://localhost:9222/json')"));
  });

  it('allows IIFE with chart logic', () => {
    assert.doesNotThrow(() => validateExpression(`
      (function() {
        var el = document.querySelector('[data-name="chart"]');
        return el ? el.textContent : null;
      })()
    `));
  });

  it('rejects non-string input', () => {
    assert.throws(() => validateExpression(123), /must be a string/);
    assert.throws(() => validateExpression(null), /must be a string/);
  });
});

describe('evaluate-filter — getEvaluateMode()', () => {
  const originalEnv = process.env.TV_MCP_ALLOW_UI_EVALUATE;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TV_MCP_ALLOW_UI_EVALUATE;
    else process.env.TV_MCP_ALLOW_UI_EVALUATE = originalEnv;
  });

  it('defaults to "filtered" when env var is not set', () => {
    delete process.env.TV_MCP_ALLOW_UI_EVALUATE;
    assert.equal(getEvaluateMode(), 'filtered');
  });

  it('returns "disabled" when set', () => {
    process.env.TV_MCP_ALLOW_UI_EVALUATE = 'disabled';
    assert.equal(getEvaluateMode(), 'disabled');
  });

  it('returns "unrestricted" when set', () => {
    process.env.TV_MCP_ALLOW_UI_EVALUATE = 'unrestricted';
    assert.equal(getEvaluateMode(), 'unrestricted');
  });

  it('returns "filtered" for unknown values', () => {
    process.env.TV_MCP_ALLOW_UI_EVALUATE = 'something-else';
    assert.equal(getEvaluateMode(), 'filtered');
  });

  it('is case-insensitive', () => {
    process.env.TV_MCP_ALLOW_UI_EVALUATE = 'DISABLED';
    assert.equal(getEvaluateMode(), 'disabled');
  });
});

describe('evaluate-filter — pattern coverage', () => {
  it('has at least 20 blocked patterns', () => {
    assert.ok(BLOCKED_PATTERNS.length >= 20, `Expected >= 20 patterns, got ${BLOCKED_PATTERNS.length}`);
  });

  it('every pattern has a reason string', () => {
    for (const entry of BLOCKED_PATTERNS) {
      assert.ok(entry.pattern instanceof RegExp, 'pattern must be a RegExp');
      assert.ok(typeof entry.reason === 'string' && entry.reason.length > 0, 'reason must be a non-empty string');
    }
  });
});
