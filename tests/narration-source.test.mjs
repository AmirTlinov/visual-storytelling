import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { narrationSource } from '../tools/story-document.mjs';
import { buildNarration, prepareNarration } from '../tools/narration.mjs';

const compiled = await build({
  entryPoints: ['src/story/document.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});

async function fixture(t, document) {
  const root = await mkdtemp(join(tmpdir(), 'canonical-narration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'scene');
  const consumer = join(root, 'node_modules/@visual-storytelling/core');
  await mkdir(join(consumer, 'dist/story'), { recursive: true });
  await mkdir(directory);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: '@visual-storytelling/core',
      version: '0.0.0-fixture',
      type: 'module',
    }),
  );
  await writeFile(join(consumer, 'dist/story/document.js'), compiled.outputFiles[0].text);
  await writeFile(join(directory, 'story.json'), JSON.stringify(document));
  return directory;
}

const staticDocument = {
  version: 2,
  models: [{ id: 'division', module: 'division', inputs: { count: 23, divisor: 3 } }],
  views: [{ id: 'groups', kind: 'groups', model: 'division' }],
  chapters: [],
};

test('static and explicitly silent documents do not project stale legacy speech or invoke a provider', async (t) => {
  for (const document of [
    staticDocument,
    {
      version: 2,
      models: [],
      views: [],
      chapters: [
        {
          id: 'look',
          title: 'Посмотрите',
          beats: [{ id: 'pause', text: 'Два предмета', say: '', seconds: 2 }],
        },
      ],
    },
  ]) {
    const directory = await fixture(t, document);
    // Leftover voice settings and accepted assets must not turn a silent source into speech.
    await writeFile(
      join(directory, 'voice.json'),
      JSON.stringify({ enabled: true, provider: 'api', adapter: 'missing.mjs' }),
    );
    await writeFile(
      join(directory, 'narration.json'),
      JSON.stringify({ version: 3, segments: [{ id: 'old', text: 'Старая речь.' }] }),
    );
    await writeFile(join(directory, 'audio.wav'), 'accepted asset');
    await writeFile(join(directory, 'index.html'), '<main>Тихий опыт</main>');
    const original = Object.fromEntries(
      await Promise.all(
        (await readdir(directory)).map(async (name) => [
          name,
          await readFile(join(directory, name), 'utf8'),
        ]),
      ),
    );
    assert.equal(await narrationSource(directory), undefined);
    await assert.rejects(buildNarration(directory), /no authored speech/);
    await prepareNarration(directory, { audible: true });
    assert.deepEqual(
      Object.fromEntries(
        await Promise.all(
          (await readdir(directory)).map(async (name) => [
            name,
            await readFile(join(directory, name), 'utf8'),
          ]),
        ),
      ),
      original,
    );
  }
});

test('canonical spoken beats project through their own runtime without altering the authored document', async (t) => {
  const document = {
    version: 2,
    title: 'Цепь',
    models: [],
    views: [],
    chapters: [
      {
        id: 'room',
        title: 'В мастерской',
        beats: [
          {
            id: 'point',
            text: 'Посмотрите сюда',
            say: 'Проследим цепь.',
            perform: [{ action: 'point', actor: 'hero', target: 'board.content' }],
          },
        ],
      },
    ],
  };
  const directory = await fixture(t, document);
  const original = await readFile(join(directory, 'story.json'), 'utf8');
  const projection = await narrationSource(directory);
  t.after(() => rm(dirname(projection.file), { recursive: true, force: true }));
  const speech = JSON.parse(await readFile(projection.file, 'utf8'));
  assert.equal(projection.directory, directory);
  assert.equal(speech.segments[0].text, 'Проследим цепь.');
  assert.equal(speech.segments[0].cues[0].id, 'room.point');
  assert.equal(await readFile(join(directory, 'story.json'), 'utf8'), original);
  assert.equal(
    await readFile(join(directory, 'narration.json')).catch((error) => error.code),
    'ENOENT',
  );
});

test('a malformed canonical document is rejected before any speech backend is inspected', async (t) => {
  const directory = await fixture(t, {
    ...staticDocument,
    views: [{ id: 'groups', kind: 'groups', model: 'missing' }],
  });
  await assert.rejects(buildNarration(directory), /views\[0\]\.model: unknown model/);
  await writeFile(join(directory, 'story.json'), 'null');
  await writeFile(
    join(directory, 'narration.json'),
    JSON.stringify({ version: 3, segments: [{ id: 'old', text: 'Старая речь.' }] }),
  );
  await assert.rejects(narrationSource(directory), /document: expected an object/);
});
