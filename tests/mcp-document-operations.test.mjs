import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { documentOperations } from '../plugin/mcp/document-operations.mjs';
import { validateStoryDocument, editStoryDocument } from '../dist/index.js';

test('MCP editing exposes op choices and visible text before an author writes a request', () => {
  const schema = z.toJSONSchema(documentOperations);
  const text = JSON.stringify(schema);
  for (const name of ['set-inputs', 'set-resources', 'set-views', 'set-chapters'])
    assert(text.includes(name));
  assert(text.includes('Short visible narrative caption'));
  assert(text.includes('not a visible caption'));
  const doc = validateStoryDocument({ recipe: 'division', inputs: { count: 17, divisor: 4 } });
  assert.equal(
    documentOperations.safeParse([{ type: 'set-chapters', chapters: doc.chapters }]).success,
    false,
  );
  const chapter = {
    id: 'experience',
    title: 'Разложим предметы',
    beats: [
      {
        id: 'gather',
        text: 'Соберём предметы вместе.',
        operation: { model: 'division', name: 'gather' },
        seconds: 1,
      },
      {
        id: 'group',
        text: 'Разложим их по четыре.',
        operation: { model: 'division', name: 'group' },
        seconds: 2,
      },
      {
        id: 'remainder',
        text: 'Одного не хватает для новой группы.',
        operation: { model: 'division', name: 'remainder' },
        seconds: 1,
      },
    ],
  };
  const operations = documentOperations.parse([
    { op: 'set-inputs', modelId: 'division', values: { count: 19 } },
    { op: 'set-chapters', chapters: [chapter] },
  ]);
  const edited = editStoryDocument(doc, operations);
  assert.equal(edited.models[0].inputs.count, 19);
  assert.equal(edited.chapters[0].beats[1].text, chapter.beats[1].text);
});

test('MCP transport preserves shipped custom model/view/staging/speech payloads for pinned-core validation', async () => {
  for (const name of ['gpt-model', 'spatial-order', 'cube-section', 'push-block']) {
    const doc = JSON.parse(
      await readFile(new URL('../examples/' + name + '/story.json', import.meta.url), 'utf8'),
    );
    const operations = [
      ...doc.models.map((model) => ({ op: 'set-inputs', modelId: model.id, values: model.inputs })),
      { op: 'set-views', views: doc.views },
      { op: 'set-resources', resources: doc.resources ?? [] },
      { op: 'set-chapters', chapters: doc.chapters },
    ];
    assert.deepEqual(documentOperations.parse(operations), operations, name);
  }
});
