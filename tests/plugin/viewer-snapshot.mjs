import assert from 'node:assert/strict';

/** Independently check the measured result, rather than trusting control values or markup. */
export function assertViewerSnapshot(recipe, values, snapshot) {
  const rational = (quantity) => {
    assert(Number.isSafeInteger(quantity?.numerator));
    assert(Number.isSafeInteger(quantity?.denominator) && quantity.denominator > 0);
    return quantity;
  };
  if (recipe === 'division') {
    assert.equal(snapshot.count, values.count);
    assert.equal(snapshot.divisor, values.divisor);
    assert.equal(snapshot.quotient, Math.floor(values.count / values.divisor));
    assert.equal(snapshot.remainder, values.count % values.divisor);
    assert.equal(snapshot.parts.length, values.count);
  } else if (recipe === 'fractions') {
    const numerator =
      values.leftNumerator * values.rightDenominator +
      values.rightNumerator * values.leftDenominator;
    const denominator = values.leftDenominator * values.rightDenominator;
    for (const quantity of [snapshot.result, snapshot.total].map(rational))
      assert.equal(quantity.numerator * denominator, numerator * quantity.denominator);
    const left = snapshot.roots.find((part) => part.id === 'fractions:left');
    rational(left?.amount);
    assert.equal(
      left.amount.numerator * values.leftDenominator,
      values.leftNumerator * left.amount.denominator,
    );
  } else {
    assert.equal(recipe, 'dependency-route');
    assert.equal(snapshot.orderId, values.orderId);
    assert.equal(snapshot.status, values['disabled-provider'] ? 'blocked' : 'delivered');
    assert.equal(snapshot.blocked, values['disabled-provider'] ? 'provider' : null);
    assert.deepEqual(
      snapshot.route,
      values['disabled-provider']
        ? ['shop', 'gateway', 'provider']
        : ['shop', 'gateway', 'provider', 'bank'],
    );
    assert(snapshot.events.every((event) => event.orderId === values.orderId));
  }
}
