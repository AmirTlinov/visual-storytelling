import test from 'node:test';
import assert from 'node:assert/strict';
import { leverState, rational } from '../dist/index.js';
import { compareModelSnapshots } from '../dist/story/index.js';
import { comparisonModel, leverModel, instructionalRouteModel } from '../dist/recipes/index.js';
const load = (force, cm) => ({ force: rational(force), arm: rational(cm, 100) });
test('the horizontal lever uses exact signed N·m, including zero arms and small imbalance', () => {
  const balance = leverState(load(2, 30), load(3, 20));
  assert.equal(balance.equilibrium, true);
  assert.deepEqual(balance.left.moment, rational(3, 5));
  assert.deepEqual(balance.requiredVerticalReaction, rational(5));
  assert.deepEqual(leverState(load(1, 1), load(0, 0)).netMoment, rational(1, 100));
  const pin = leverState(load(7, 0), load(0, 0));
  assert.equal(pin.equilibrium, true);
  assert.deepEqual(pin.requiredVerticalReaction, rational(7));
  assert.equal(leverState(load(1, 1), load(0, 0)).direction, 'left-down');
  assert.equal(leverState(load(0, 0), load(1, 1)).direction, 'right-down');
  const M = Number.MAX_SAFE_INTEGER;
  assert.throws(
    () =>
      leverState(
        { force: rational(1), arm: rational(M - 1, M) },
        { force: rational(1), arm: rational(M - 2, M - 1) },
      ),
    /safe integer/,
  );
  const tiny = leverState({ force: rational(1), arm: rational(1, M) }, load(0, 0));
  assert.equal(tiny.equilibrium, false);
  assert.deepEqual(tiny.netMoment, rational(1, M));
});
test('comparison preserves controlled inputs, branch IDs and baseline; invalid changes fail', () => {
  const inputs = { leftForce: 10, leftArm: 40, rightForce: 10, rightArm: 20 };
  const model = { id: 'balance', module: 'lever', inputs };
  const pair = compareModelSnapshots(leverModel, model, { rightForce: 20 });
  assert.equal(pair.before.state.equilibrium, false);
  assert.equal(pair.after.state.equilibrium, true);
  assert.deepEqual(pair.changes, [{ key: 'rightForce', before: 10, after: 20 }]);
  assert.deepEqual(pair.controlled, ['leftForce', 'leftArm', 'rightArm']);
  assert.equal(pair.before.id, 'balance:before');
  assert.equal(pair.after.id, 'balance:after');
  assert.deepEqual(inputs, { leftForce: 10, leftArm: 40, rightForce: 10, rightArm: 20 });
  assert.throws(() => compareModelSnapshots(leverModel, model, { rightArm: -1 }));
  assert.throws(() => compareModelSnapshots(leverModel, model, { gravity: 9.8 }), /Unknown/);
});
test('comparison wrapper preserves domain progress and rejects computed inputs or mutating owners', () => {
  const owner = {
    validateInputs: (v) => ({ progress: v.progress }),
    state: (inputs) => ({ ...inputs }),
    operations: {},
    validateViews() {},
    focusTargets: () => [],
  };
  const module = comparisonModel({
    module: 'p',
    model: owner,
    keys: ['progress'],
    views: () => [],
  });
  const inputs = module.validateInputs({
    progress: 5,
    comparisonChange: 'progress',
    comparisonValue: 6,
  });
  const state = module.staticState(inputs);
  assert.equal(state.comparison.before.inputs.progress, 5);
  assert.equal(state.comparison.after.inputs.progress, 6);
  assert.equal(state.progress, 5);
  assert.equal(state.comparisonProgress, 1);
  assert.equal(module.operations.change(state, 0.5).progress, 5);
  assert.throws(() => module.validateInputs({ ...inputs, comparison: {} }), /Computed/);
  assert.throws(
    () =>
      compareModelSnapshots(
        {
          ...owner,
          state: (inputs) => {
            inputs.progress++;
            return { ...inputs };
          },
        },
        { id: 'p', module: 'p', inputs: { progress: 5 } },
        { progress: 6 },
      ),
    TypeError,
  );
});
test('the same comparison owner exposes route counterexamples without improving uncontrolled inputs', () => {
  for (const disabled of [
    {},
    { 'disabled-provider': true },
    { 'disabled-bank': true },
    { 'disabled-provider': true, 'disabled-independent': true },
  ]) {
    const pair = compareModelSnapshots(
      instructionalRouteModel,
      {
        id: 'order',
        module: 'dependency-route',
        inputs: { orderId: '417', reserve: 'shared', ...disabled },
      },
      { reserve: 'independent' },
    );
    assert.deepEqual(pair.changes, [{ key: 'reserve', before: 'shared', after: 'independent' }]);
    assert.equal(pair.before.state.trace.orderId, '417');
    assert.equal(pair.after.state.trace.orderId, '417');
    const status =
      disabled['disabled-bank'] || disabled['disabled-independent'] ? 'blocked' : 'delivered';
    assert.equal(pair.after.state.trace.status, status);
    assert.equal(
      pair.before.state.trace.status,
      disabled['disabled-provider'] || disabled['disabled-bank'] ? 'blocked' : 'delivered',
    );
  }
});
