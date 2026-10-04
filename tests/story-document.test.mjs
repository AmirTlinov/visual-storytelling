import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrationSource } from '../tools/story-document.mjs';
const source = await build({
  entryPoints: ['src/book/document.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});

const { documentNarration, documentScript, authoredChapter } = await import(
  'data:text/javascript;base64,' + Buffer.from(source.outputFiles[0].text).toString('base64')
);
const document = {
  title: 'Путь света',
  chapters: [
    {
      id: 'room',
      title: 'В комнате',
      beats: [
        {
          id: 'switch',
          say: 'Разомкнём цепь.',
          text: 'Лампа гаснет.',
          perform: [{ action: 'press', actor: 'hero', target: 'switch' }],
        },
      ],
    },
    {
      id: 'paper',
      title: 'На странице',
      beats: [{ id: 'try', say: 'Проверьте сами.', text: 'Переключатель доступен.' }],
    },
  ],
};
test('speech projection follows the scene consumer inherited from its workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-projection-owner-'));
  let projection;
  try {
    const consumer = join(directory, 'node_modules/@visual-storytelling/core');
    const scene = join(directory, 'scenes/circuit');
    await mkdir(join(consumer, 'dist/book'), { recursive: true });
    await mkdir(scene, { recursive: true });
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify({ name: '@visual-storytelling/core', version: '7.0.0', type: 'module' }),
    );
    await writeFile(
      join(consumer, 'dist/book/document.js'),
      'export const documentNarration = document => ({ owner: "scene-consumer-7", title: document.title, intro: .75 });',
    );
    await writeFile(join(scene, 'story.json'), JSON.stringify(document));
    projection = await narrationSource(scene);
    assert.equal(projection.directory, scene);
    assert.deepEqual(JSON.parse(await readFile(projection.file, 'utf8')), {
      owner: 'scene-consumer-7',
      title: document.title,
      intro: 0.75,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (projection) await rm(projection.file, { force: true });
  }
});
test('one authored document feeds action IDs, speech and aligned page transitions', () => {
  const spec = documentNarration(document);
  assert.equal(spec.segments[0].text, document.chapters[0].beats[0].say);
  assert.equal(spec.segments[0].cues[0].id, 'room.switch');
  assert.deepEqual(
    authoredChapter(document, 'room').beats[0].perform,
    document.chapters[0].beats[0].perform,
  );
  const aligned = {
    duration: 13,
    cues: { 'room.switch': { start: 4.4, end: 7 }, 'paper.try': { start: 10, end: 12 } },
    segments: [
      { id: 'room', start: 4.4, end: 7, text: 'Разомкнём цепь.' },
      { id: 'paper', start: 10, end: 12, text: 'Проверьте сами.' },
    ],
  };
  const script = documentScript(document, aligned);
  assert.deepEqual(script.cues['paper.try'], aligned.cues['paper.try']);
  assert.equal(script.cues.paper.start, 8.9);
  assert.throws(
    () =>
      documentScript(document, {
        ...aligned,
        segments: [aligned.segments[0], { ...aligned.segments[1], start: 7.5 }],
      }),
    /before chapter/,
  );
  assert.throws(
    () =>
      documentNarration({ ...document, chapters: [document.chapters[0], document.chapters[0]] }),
    /Invalid chapter/,
  );
  const owned = { ...document, narration: { voice: { seed: 1 }, music: { path: 'a.wav' } } };
  const projection = documentNarration(owned);
  projection.voice.seed = 2;
  projection.music.path = 'b.wav';
  assert.equal(owned.narration.voice.seed, 1);
  assert.equal(owned.narration.music.path, 'a.wav');
});

test('repeated thoughts bind to their own spoken words, including a quote inside an earlier thought', async () => {
  const sayings = [
    'Сначала цепь замкнута.',
    'Цепь замкнута!',
    'ЦЕПЬ замкнута.',
    'Ток идёт.',
    'Ток идет!',
  ];
  const spec = documentNarration({
    title: 'Повтор',
    chapters: [
      {
        id: 'room',
        title: 'Комната',
        beats: sayings.map((say, index) => ({ id: `say${index}`, say, text: 'Видимое действие' })),
      },
    ],
  });
  assert.deepEqual(
    spec.segments[0].cues.map((c) => c.occurrence),
    [1, 2, 3, 1, 2],
  );
  const directory = await mkdtemp(join(tmpdir(), 'story-words-'));
  try {
    const file = join(directory, 'narration.json');
    await writeFile(file, JSON.stringify(spec));
    const { stdout } = await promisify(execFile)(
      'python3',
      [
        '-c',
        'import json,sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from script import read_script;print(json.dumps([[c["word_start"],c["word_end"]] for c in read_script(Path(sys.argv[2]))["segments"][0]["cues"]]))',
        fileURLToPath(new URL('../tools/audio', import.meta.url)),
        file,
      ],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
    );
    assert.deepEqual(JSON.parse(stdout), [
      [0, 3],
      [3, 5],
      [5, 7],
      [7, 9],
      [9, 11],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.throws(
    () =>
      documentNarration({
        title: 'Invalid',
        chapters: [{ id: 'room', title: 'Room', beats: [{ say: 'Речь.', text: 'Действие' }] }],
      }),
    /unique ID/,
  );
});
