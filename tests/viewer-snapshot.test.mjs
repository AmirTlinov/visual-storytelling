import test from 'node:test';
import assert from 'node:assert/strict';
import { assertViewerSnapshot } from './plugin/viewer-snapshot.mjs';

test('updated controls cannot pass with an old division or fraction result', () => {
  const division = { count: 18, divisor: 4 };
  const result = { ...division, quotient: 4, remainder: 2, parts: Array(18).fill({}) };
  assertViewerSnapshot('division', division, result);
  assert.throws(() => assertViewerSnapshot('division', { ...division, count: 19 }, result));
  assert.throws(() => assertViewerSnapshot('division', division, { ...result, remainder: 1 }));
  const values = { leftNumerator: 2, leftDenominator: 3, rightNumerator: 1, rightDenominator: 3 };
  const fraction = {
    result: { numerator: 1, denominator: 1 },
    total: { numerator: 1, denominator: 1 },
    roots: [{ id: 'fractions:left', amount: { numerator: 2, denominator: 3 } }],
  };
  assertViewerSnapshot('fractions', values, fraction);
  assert.throws(() =>
    assertViewerSnapshot('fractions', values, {
      ...fraction,
      result: { numerator: 0, denominator: 0 },
    }),
  );
  assert.throws(() => assertViewerSnapshot('fractions', { ...values, leftNumerator: 1 }, fraction));
  assert.throws(() =>
    assertViewerSnapshot('fractions', values, {
      ...fraction,
      total: { numerator: 2, denominator: 3 },
    }),
  );
});

test('a provider toggle must change the route result and preserve the same order', () => {
  const values = { orderId: '417', 'disabled-provider': true };
  const state = {
    orderId: '417',
    status: 'blocked',
    blocked: 'provider',
    route: ['shop', 'gateway', 'provider'],
    events: [{ kind: 'stop', node: 'provider', orderId: '417' }],
  };
  assertViewerSnapshot('dependency-route', values, state);
  assertViewerSnapshot(
    'dependency-route',
    { ...values, 'disabled-provider': false },
    {
      ...state,
      status: 'delivered',
      blocked: null,
      route: ['shop', 'gateway', 'provider', 'bank'],
    },
  );
  assert.throws(() =>
    assertViewerSnapshot('dependency-route', { ...values, 'disabled-provider': false }, state),
  );
  assert.throws(() =>
    assertViewerSnapshot('dependency-route', values, { ...state, events: [{ orderId: '418' }] }),
  );
});
