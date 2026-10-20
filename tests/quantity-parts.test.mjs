import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rational,
  addRational,
  sumRational,
  divideRational,
  rationalText,
  commonDenominator,
} from '../dist/math/rational.js';
import {
  quantityPart,
  quantityParts,
  quantityTotal,
  splitQuantity,
  transferQuantity,
  copyQuantity,
  mergeQuantity,
} from '../dist/math/quantity-parts.js';
test('exact rational arithmetic reduces after BigInt intermediates and rejects unrepresentable values', () => {
  assert.equal(rationalText(addRational(rational(1, 2), rational(1, 3))), '5/6');
  assert.deepEqual(divideRational(rational(5, 6), 5), rational(1, 6));
  assert.deepEqual(rational(0, -12), rational(0));
  assert.equal(commonDenominator(8, 12), 24);
  assert.deepEqual(
    addRational(rational(Number.MAX_SAFE_INTEGER, 2), rational(Number.MAX_SAFE_INTEGER, 2)),
    rational(Number.MAX_SAFE_INTEGER),
  );
  assert.throws(() => addRational(rational(Number.MAX_SAFE_INTEGER), rational(1)));
  assert.throws(() => rational(1, 0));
  assert.throws(() => rational(0.5, 2));
});
test('aggregate storage bounds apply after the complete exact sum in every permutation', () => {
  const values = [
    rational(1, 100000007),
    rational(1, 100000009),
    rational(100000006, 100000007),
    rational(100000008, 100000009),
  ];
  function* permutations(items) {
    if (!items.length) yield [];
    for (let i = 0; i < items.length; i++)
      for (const rest of permutations(items.filter((_, index) => index !== i)))
        yield [items[i], ...rest];
  }
  for (const order of permutations(values)) {
    assert.deepEqual(sumRational(order), rational(2));
    const parts = order.map((amount, index) =>
      quantityPart(`leaf-${index}`, amount, 'whole', 'source'),
    );
    assert.deepEqual(quantityTotal(parts, 'whole'), rational(2));
    const merged = mergeQuantity(
      parts,
      parts.map((part) => part.id),
      'sum',
      'result',
    );
    assert.deepEqual(merged[0].amount, rational(2));
    assert.deepEqual(quantityParts(merged), merged);
  }
});
test('split, transfer and merge preserve exact magnitude, units and leaf contributions; copy is explicit', () => {
  let parts = quantityParts([
    quantityPart('half', rational(1, 2), 'whole', 'left'),
    quantityPart('third', rational(1, 3), 'whole', 'right'),
  ]);
  const original = parts;
  parts = splitQuantity(parts, 'half', 3);
  parts = splitQuantity(parts, 'third', 2);
  assert.equal(parts.length, 5);
  assert.equal(rationalText(quantityTotal(parts, 'whole')), '5/6');
  assert.ok(parts.every((part) => part.amount.denominator === 6));
  const ids = parts.map((part) => part.id);
  parts = transferQuantity(parts, ids, 'result');
  assert.deepEqual(
    parts.map((part) => part.id),
    ids,
  );
  assert.equal(original[0].container, 'left');
  assert.ok(parts.every((part) => part.container === 'result'));
  const merged = mergeQuantity(parts, ids, 'sum', 'result');
  assert.throws(() => splitQuantity(merged, 'sum', 2), /constituent/);
  assert.deepEqual(merged[0].origins, [
    { id: 'half', amount: rational(1, 2) },
    { id: 'third', amount: rational(1, 3) },
  ]);
  const copied = copyQuantity(original, 'half', 'half-copy', 'result');
  assert.equal(rationalText(quantityTotal(copied, 'whole')), '4/3');
  assert.equal(copied[2].copiedFrom, 'half');
  assert.equal(copied[0].id, 'half');
});
test('invalid parts, lost origins, mixed units, duplicate identities and impossible splits fail before state changes', () => {
  const part = quantityPart('a', rational(1), 'cm²', 'source');
  const parts = [part];
  assert.throws(() => quantityParts([part, part]));
  assert.throws(() => quantityParts([{ ...part, origins: [] }]), /entire/);
  assert.throws(() => splitQuantity(parts, 'a', 0));
  assert.throws(() => splitQuantity(parts, 'a', 4097));
  assert.throws(() => copyQuantity(parts, 'a', 'a', 'destination'));
  const split = splitQuantity(parts, 'a', 2);
  assert.throws(() => copyQuantity(split, 'a:part:0', 'a', 'destination'), /provenance/);
  const collision = splitQuantity(
    [part, quantityPart('a:part:0', rational(1), 'cm²', 'source')],
    'a:part:0',
    2,
  );
  assert.throws(() => splitQuantity(collision, 'a', 2), /provenance/);

  assert.throws(
    () =>
      mergeQuantity(
        split,
        split.map((part) => part.id),
        'a',
        'destination',
      ),
    /provenance/,
  );
  assert.throws(() => transferQuantity(parts, ['missing'], 'destination'));
  assert.throws(() => quantityTotal([part, quantityPart('b', rational(1), 'cm', 'source')], 'cm²'));
  assert.deepEqual(parts, [part]);
  assert.equal(
    splitQuantity([quantityPart('zero', rational(0), 'whole', 'source')], 'zero', 0).length,
    0,
  );
});
test('fractions of incompatible reference wholes and self-dependent merge identities are rejected', () => {
  const a = quantityPart('a', rational(1, 2), 'whole', 'left', { reference: 'large-whole' });
  const b = quantityPart('b', rational(1, 2), 'whole', 'right', { reference: 'small-whole' });
  assert.throws(() => mergeQuantity([a, b], ['a', 'b'], 'sum', 'result'), /reference/);
  assert.throws(
    () =>
      mergeQuantity(
        [a, quantityPart('c', rational(1, 2), 'whole', 'right', { reference: 'large-whole' })],
        ['a', 'c'],
        'a',
        'result',
      ),
    /distinct identity/,
  );
});
