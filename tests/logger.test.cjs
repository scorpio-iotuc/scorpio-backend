require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Logger } = require('../src/lib/Logger');

test('logger includes UTC timestamp, level, service and routes levels to their streams', (t) => {
  const out = t.mock.method(console, 'log', () => {});
  const err = t.mock.method(console, 'error', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  const logger = new Logger('Satellites');
  logger.info('Queued', { jobId: 'job-1' });
  logger.debug('Checking');
  logger.warn('Retry');
  logger.error('Failed');
  const line = out.mock.calls[0].arguments[0];
  assert.match(line, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[Satellites\] Queued/);
  assert.match(line, /job-1/);
  assert.match(out.mock.calls[1].arguments[0], /\[DEBUG\]/);
  assert.match(warn.mock.calls[0].arguments[0], /\[WARN\]/);
  assert.match(err.mock.calls[0].arguments[0], /\[ERROR\]/);
});

test('logger keeps nested error stacks and circular context on a single line', (t) => {
  const err = t.mock.method(console, 'error', () => {});
  const context = { error: new Error('import failed') };
  context.self = context;
  new Logger('Worker').error('Failure\nwith details', context);
  const line = err.mock.calls[0].arguments[0];
  assert.match(line, /Error: import failed/);
  assert.match(line, /logger.test.cjs/);
  assert.match(line, /Circular/);
  assert.equal(line.includes('\n'), false);
});
