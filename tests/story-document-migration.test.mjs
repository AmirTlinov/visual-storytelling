import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  convertLegacyStoryDocument,
  migrateStoryDocument,
} from '../tools/migrate-story-document.mjs';
import { validateStoryDocument, documentNarration } from '../dist/story/document.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const legacyEntry = `import { mountExplanation } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import explanation from './explanation.json';

window.galleryReady = Promise.resolve().then(() =>
  mountExplanation(document.querySelector('main'), explanation),
);
`;
const legacy = {
  version: 1,
  title: 'Как появляется остаток?',
  model: { id: 'apples', kind: 'division', count: 17, divisor: 5 },
  views: [{ id: 'objects', kind: 'groups', model: 'apples' }],
  score: [
    { id: 'collect', action: 'group', seconds: 4 },
    { id: 'notice', focus: ['remainder'], hold: true, text: 'Два предмета остались.', seconds: 3 },
  ],
};

test('explicit conversion preserves model, view and beat identities, holds and focus references', () => {
  const document = validateStoryDocument(convertLegacyStoryDocument(legacy, { explanation: true }));
  assert.deepEqual(document.models, [
    { id: 'apples', module: 'division', inputs: { count: 17, divisor: 5 } },
  ]);
  assert.deepEqual(document.views, legacy.views);
  assert.equal(document.chapters[0].beats[0].id, 'collect');
  assert.deepEqual(document.chapters[0].beats[0].operation, { model: 'apples', name: 'group' });
  assert.deepEqual(document.chapters[0].beats[1].focus, ['apples:remainder']);
  assert.equal(typeof document.chapters[0].beats[1].hold, 'string');
  const collision = validateStoryDocument(
    convertLegacyStoryDocument(
      {
        model: { id: 'groups', kind: 'division', count: 4, divisor: 3 },
        score: [{ id: 'focus', focus: ['groups'] }],
      },
      { explanation: true },
    ),
  );
  assert.deepEqual(collision.chapters[0].beats[0].focus, ['groups.view']);
  const chapterCollision = validateStoryDocument(
    convertLegacyStoryDocument(
      {
        ...legacy,
        model: { ...legacy.model, id: 'experience' },
        views: [{ id: 'experience.story', kind: 'groups', model: 'experience' }],
      },
      { explanation: true },
    ),
  );
  assert.equal(chapterCollision.models[0].id, 'experience');
  assert.equal(chapterCollision.views[0].id, 'experience.story');
  assert.equal(chapterCollision.chapters[0].id, 'experience.story.story');
  assert.throws(
    () => convertLegacyStoryDocument({ ...legacy, custom: 1 }, { explanation: true }),
    /custom field/,
  );
  assert.throws(() => validateStoryDocument(legacy), /unknown field|expected 2/);
});

test('ordinary legacy story converts to the same document and speech projection without invented models', () => {
  const source = {
    title: 'Проверяем площадь',
    chapters: [
      {
        id: 'area',
        title: 'Прямоугольник',
        beats: [
          { id: 'predict', hold: 'Предсказать площадь', seconds: 2 },
          {
            id: 'show',
            text: 'Два ряда по три клетки дают шесть.',
            action: 'Показать клетки',
            seconds: 4,
          },
        ],
      },
    ],
    narration: { pause: 0, voice: { seed: 42 } },
  };
  const document = validateStoryDocument(convertLegacyStoryDocument(source));
  assert.deepEqual(document.models, []);
  assert.deepEqual(document.chapters, source.chapters);
  assert.deepEqual(document.narration, source.narration);
  const narration = documentNarration(document);
  assert.equal(narration.segments[0].text, source.chapters[0].beats[1].text);
});

async function fixture(t, document = legacy) {
  const directory = await mkdtemp(join(tmpdir(), 'story-document-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = join(directory, 'original'),
    snapshot = join(directory, 'snapshot');
  await mkdir(original);
  await writeFile(join(original, 'explanation.json'), JSON.stringify(document));
  await writeFile(join(original, 'scene.js'), legacyEntry);
  await writeFile(
    join(original, 'index.html'),
    '<!doctype html><main></main><script type="module" src="scene.js"></script>',
  );
  await writeFile(join(original, 'scene-runtime.json'), 'accepted old pin\n');
  await writeFile(join(original, 'audio.wav'), Buffer.from([0, 1, 2, 3]));
  await cp(original, snapshot, { recursive: true });
  return { original, snapshot };
}

test('prepared legacy conversion changes only its candidate, removes old input and preserves accepted audio and pin', async (t) => {
  const { original, snapshot } = await fixture(t);
  const supplied = [
    { path: 'scene.js', content: null },
    { path: 'index.html', content: null },
    {
      path: 'story-project.json',
      content: JSON.stringify({ version: 1, modules: [], resources: [] }),
    },
  ];
  for (const change of supplied) {
    if (change.content === null) await rm(join(snapshot, change.path));
    else await writeFile(join(snapshot, change.path), change.content);
  }
  const changes = await migrateStoryDocument(snapshot, { root, changes: supplied });
  assert.deepEqual(
    changes.map((change) => change.path),
    ['story.json', 'explanation.json'],
  );
  assert.equal(changes.at(-1).content, null);
  const converted = validateStoryDocument(
    JSON.parse(await readFile(join(snapshot, 'story.json'), 'utf8')),
  );
  assert.equal(converted.models[0].inputs.count, 17);
  await assert.rejects(access(join(snapshot, 'scene.js')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(join(snapshot, 'story-project.json'), 'utf8')), {
    version: 1,
    modules: [],
    resources: [],
  });
  await assert.rejects(access(join(snapshot, 'explanation.json')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(join(original, 'explanation.json'), 'utf8')), legacy);
  for (const name of ['audio.wav', 'scene-runtime.json'])
    assert.deepEqual(await readFile(join(snapshot, name)), await readFile(join(original, name)));
});

test('invalid legacy input and unknown custom entry fail before candidate document writes', async (t) => {
  const { snapshot } = await fixture(t, { ...legacy, model: { ...legacy.model, divisor: 0 } });
  await assert.rejects(migrateStoryDocument(snapshot, { root }), /divisor/);
  await assert.rejects(access(join(snapshot, 'story.json')), { code: 'ENOENT' });
  await writeFile(join(snapshot, 'explanation.json'), JSON.stringify(legacy));
  await writeFile(join(snapshot, 'scene.js'), legacyEntry + '\n// custom authored code\n');
  await assert.rejects(migrateStoryDocument(snapshot, { root }), {
    code: 'manual_scene_migration_required',
  });
  await assert.rejects(access(join(snapshot, 'story.json')), { code: 'ENOENT' });
  const changes = [{ path: 'scene.js', content: '// explicitly updated custom entry\n' }];
  await writeFile(join(snapshot, 'scene.js'), changes[0].content);
  await migrateStoryDocument(snapshot, { root, changes });
  assert.equal(await readFile(join(snapshot, 'scene.js'), 'utf8'), changes[0].content);
});
