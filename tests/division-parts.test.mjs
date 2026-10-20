import test from 'node:test';
import assert from 'node:assert/strict';
import { divisionState } from '../dist/math/division.js';
import { divisionParts } from '../dist/recipes/division-parts.js';
import { quantityTotal } from '../dist/math/quantity-parts.js';
import { rational } from '../dist/math/rational.js';
import {
  validateStoryDocument,
  documentTimeline,
  documentModelsAt,
} from '../dist/story/document.js';
import { cueSheet } from '../dist/story/cues.js';
test('bounded division moves the same measured objects while numeric division stays unbounded', () => {
  const model = divisionState(17, 5, { id: 'objects' });
  const initial = divisionParts(model, 0);
  for (const progress of [0, 0.01, 0.25, 0.5, 0.75, 1]) {
    const parts = divisionParts(model, progress);
    assert.deepEqual(
      parts.map((part) => part.id),
      initial.map((part) => part.id),
    );
    assert.deepEqual(
      parts.map((part) => part.origins),
      initial.map((part) => part.origins),
    );
    assert.deepEqual(quantityTotal(parts, 'предмет'), rational(17));
  }
  const huge = divisionState(Number.MAX_SAFE_INTEGER, 12);
  assert.equal(huge.count, Number.MAX_SAFE_INTEGER);
  assert.throws(() => divisionParts(huge, 0), /bounded/);
  const document = validateStoryDocument({
    recipe: 'division',
    id: 'objects',
    inputs: { count: 17, divisor: 5 },
  });
  const cues = cueSheet(documentTimeline(document));
  for (const time of [0, 2, 4, 8])
    assert.deepEqual(
      documentModelsAt(document, cues.at(time)).models.objects.parts,
      divisionParts(model, documentModelsAt(document, cues.at(time)).models.objects.progress),
    );
});
