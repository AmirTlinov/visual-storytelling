import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateStoryDocument,
  editStoryDocument,
  documentModelsAt,
  documentTimeline,
  documentChapter,
} from '../dist/story/index.js';
import { cueSheet } from '../dist/story/index.js';
const source = JSON.parse(
  await readFile('tools/document-modules/continuous-order/story.json', 'utf8'),
);
test('one continuous order replays causal conditions and exposes only chapter-selected views', () => {
  const document = validateStoryDocument(source),
    sheet = cueSheet(documentTimeline(document));
  const read = (t) => documentModelsAt(document, sheet.at(t));
  const nearEnd = (id) => sheet.script.cues[id].end - 0.01;
  assert.equal(read(nearEnd('send')).models.route.trace.status, 'delivered');
  assert.equal(read(nearEnd('failure')).models.route.trace.blocked, 'provider');
  assert.equal(read(nearEnd('shared')).models.route.reserve, 'shared');
  assert.equal(read(nearEnd('shared')).models.route.trace.blocked, 'provider');
  assert.deepEqual(read(nearEnd('shared')).models.route.trace.route, [
    'shop',
    'backup',
    'provider',
  ]);
  assert.equal(read(nearEnd('independent')).models.route.reserve, 'independent');
  assert.equal(read(nearEnd('independent')).models.route.trace.status, 'delivered');
  assert.equal(read(nearEnd('send')).models.route.reserve, 'none');
  for (const time of [0, 3.9, 4, 7.9, 8, 11.9, 12, 16.9, 20])
    assert.equal(read(time).models.route.trace.orderId, '417');
  assert.deepEqual(
    read(nearEnd('send')).views.map((v) => v.id),
    ['network'],
  );
  assert.deepEqual(documentChapter(document, 'send').views, ['network']);
  assert.equal(
    documentModelsAt(document, sheet.at(sheet.script.cues.send.end), {}, {}, { chapter: 'send' })
      .models.route['disabled-provider'],
    false,
    'outgoing end owns its own state at the shared boundary',
  );
  assert.equal(
    read(sheet.script.cues.send.end).models.route['disabled-provider'],
    true,
    'ordinary narrative seek enters the next chapter',
  );
  assert.equal(read(nearEnd('independent')).resources[0].kind, 'model');
});
test('chapter view references and unavailable focus reject atomically; selection never changes model identity', () => {
  const document = validateStoryDocument(source);
  const bad = structuredClone(document);
  bad.chapters[0].views = ['unknown'];
  assert.throws(() => validateStoryDocument(bad), /declared views/);
  bad.chapters[0].views = ['network', 'network'];
  assert.throws(() => validateStoryDocument(bad), /unique declared views/);
  bad.chapters[0].views = ['network'];
  bad.chapters[0].beats[0].focus = ['status'];
  assert.throws(() => validateStoryDocument(bad), /focus/);
  const next = editStoryDocument(document, [
    { op: 'set-chapters', chapters: document.chapters.map((c) => ({ ...c, views: ['network'] })) },
  ]);
  assert.deepEqual(next.models, document.models);
  assert.deepEqual(document.chapters[1].views, undefined);
});
