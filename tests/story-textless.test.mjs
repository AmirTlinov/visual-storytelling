import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function sourceModule(path) {
  const result = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
}
const { documentNarration, documentChapter, documentScript } =
  await sourceModule('src/story/document.ts');
const { composeChapters } = await sourceModule('src/story/composition-plan.ts');
const { compileScore } = await sourceModule('src/characters/score.ts');

const quiet = {
  title: 'Группы',
  chapters: [
    {
      id: 'groups',
      title: 'Группы',
      beats: [
        {
          id: 'gather',
          action: 'Собрать предметы в группы',
          seconds: 2,
          timing: { duration: 1.5, delay: 0.25 },
          focus: ['objects'],
        },
        {
          id: 'inspect',
          hold: 'Сравнить остаток с размером группы',
          seconds: 3,
          timing: { until: 'groups.finish' },
        },
        { id: 'finish', seconds: 1 },
      ],
    },
  ],
};

test('visual actions and holds need no title, text, captions or invented speech anchors', () => {
  const chapter = documentChapter(quiet, 'groups');
  assert.equal(chapter.seconds, 6);
  assert.equal(chapter.text, '');
  assert.deepEqual(chapter.beats[0].focus, ['objects']);
  assert.equal(chapter.beats[0].text, undefined);
  assert.equal(chapter.beats[0].timing, undefined);
  assert.deepEqual(chapter.script.cues.gather, {
    start: 0.25,
    end: 1.75,
    action: 'Собрать предметы в группы',
  });
  assert.deepEqual(chapter.script.cues.inspect, {
    start: 2,
    end: 5,
    hold: 'Сравнить остаток с размером группы',
  });
  assert.deepEqual(chapter.script.cues.finish, { start: 5, end: 6 });
  assert.deepEqual(chapter.script.segments, []);
  assert.deepEqual(documentNarration(quiet).segments, []);
  const composed = composeChapters([chapter]);
  assert.equal(composed.script.duration, 6);
  assert.deepEqual(composed.script.segments, []);
  assert.deepEqual(composed.script.cues['groups.inspect'], chapter.script.cues.inspect);
  assert.equal(composed.script.cues.groups.action, undefined);
});

test('explicit silence retains a visible caption as authored metadata without speaking it', () => {
  const document = {
    title: 'Пауза',
    chapters: [
      {
        id: 'view',
        title: 'Пауза',
        beats: [
          { id: 'observe', text: 'Посмотрите на остаток', say: '', seconds: 2 },
          { id: 'voice', say: 'Здесь осталось два предмета.', seconds: 3 },
        ],
      },
    ],
  };
  const chapter = documentChapter(document, 'view');
  assert.equal(chapter.beats[0].text, 'Посмотрите на остаток');
  assert.equal(chapter.beats[1].text, undefined, 'speech does not become mandatory visible text');
  assert.deepEqual(
    chapter.script.segments.map((segment) => segment.id),
    ['voice'],
  );
  const projection = documentNarration(document);
  assert.equal(projection.intro, 2);
  assert.equal(projection.segments[0].text, 'Здесь осталось два предмета.');
  assert.deepEqual(
    projection.segments[0].cues.map((cue) => cue.id),
    ['view.voice'],
  );
});

test('an explicit silent action duration supplies local timing while a longer authored hold remains intact', () => {
  const document = {
    title: 'Движение',
    chapters: [
      {
        id: 'motion',
        title: 'Движение',
        beats: [
          { id: 'move', timing: { duration: 1, delay: 0.5 } },
          { id: 'keep', seconds: 3, timing: { duration: 1 } },
        ],
      },
    ],
  };
  const local = documentChapter(document, 'motion');
  assert.equal(local.seconds, 4.5);
  assert.deepEqual(local.script.cues.move, { start: 0.5, end: 1.5 });
  assert.deepEqual(local.script.cues.keep, { start: 1.5, end: 2.5 });
  const script = documentScript(document, { duration: 5, cues: {}, segments: [] });
  assert.deepEqual(script.cues.motion, { start: 0, end: 4.5 });
  assert.equal(documentChapter(document, 'motion', script).seconds, local.seconds);
  assert.throws(
    () => documentScript(document, { duration: 3, cues: {}, segments: [] }),
    /Silent action motion.keep does not fit the supplied narration duration/,
    'the authored hold must also fit the supplied media duration',
  );
});

const mixed = {
  title: 'Сначала посмотреть, затем услышать',
  chapters: [
    { id: 'opening', title: 'Начало', beats: [{ id: 'show', seconds: 1.5 }] },
    {
      id: 'lesson',
      title: 'Группы',
      beats: [
        { id: 'start', say: 'Соберём группу.', timing: { until: 'compare' } },
        { id: 'compare', hold: 'Сравнить группы', seconds: 2 },
        { id: 'end', say: 'Видим остаток.' },
        { id: 'keep', seconds: 1 },
      ],
    },
    { id: 'closing', title: 'Итог', beats: [{ id: 'inspect', seconds: 2 }] },
  ],
};
const mixedAlignment = () => ({
  duration: 10,
  cues: {
    'lesson.start': { start: 2, end: 3 },
    'lesson.end': { start: 5.5, end: 6.2 },
  },
  segments: [
    {
      id: 'lesson.narration-1',
      start: 2,
      end: 3,
      text: 'Соберём группу.',
      words: [
        { text: 'Соберём', start: 2, end: 2.5 },
        { text: 'группу', start: 2.5, end: 3 },
      ],
    },
    {
      id: 'lesson.narration-2',
      start: 5.5,
      end: 6.2,
      text: 'Видим остаток.',
      words: [
        { text: 'Видим', start: 5.5, end: 5.8 },
        { text: 'остаток', start: 5.8, end: 6.2 },
      ],
    },
  ],
});

test('mixed narration reserves real pauses and the speech parser receives only non-empty runs', async () => {
  const projection = documentNarration(mixed);
  assert.equal(projection.intro, 1.5);
  assert.deepEqual(
    projection.segments.map((segment) => [segment.id, segment.text, segment.pause_after]),
    [
      ['lesson.narration-1', 'Соберём группу.', 2],
      ['lesson.narration-2', 'Видим остаток.', 3.6],
    ],
  );
  assert.equal(
    projection.segments[0].cues[0].timing,
    undefined,
    'silent action timing belongs to the document, not acoustic word alignment',
  );
  const directory = await mkdtemp(join(tmpdir(), 'story-textless-'));
  try {
    const file = join(directory, 'narration.json');
    await writeFile(file, JSON.stringify(projection));
    const { stdout } = await promisify(execFile)(
      'python3',
      [
        '-c',
        'import json,sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from script import read_script;print(json.dumps([(s["id"],len(s["cues"])) for s in read_script(Path(sys.argv[2]))["segments"]]))',
        fileURLToPath(new URL('../tools/audio', import.meta.url)),
        file,
      ],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
    );
    assert.deepEqual(JSON.parse(stdout), [
      ['lesson.narration-1', 1],
      ['lesson.narration-2', 1],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('silent beats fit between fixed acoustic anchors and silent chapters need no voice segment', () => {
  const aligned = mixedAlignment();
  const original = structuredClone(aligned);
  const script = documentScript(mixed, aligned);
  assert.deepEqual(aligned, original, 'projection must preserve acoustic input');
  assert.equal(script.segments, aligned.segments);
  assert.deepEqual(script.cues['lesson.compare'], { start: 3, end: 5, hold: 'Сравнить группы' });
  assert.deepEqual(script.cues['lesson.start'].speech, { start: 2, end: 3 });
  assert.deepEqual(script.cues.opening, { start: 0, end: 1.5 });
  assert.deepEqual(script.cues.closing, { start: 7.2, end: 9.2 });
  assert.deepEqual(documentChapter(mixed, 'closing', script).script.segments, []);
  const chapter = documentChapter(mixed, 'lesson', script);
  assert.deepEqual(chapter.script.cues.compare, { start: 1, end: 3, hold: 'Сравнить группы' });
  assert.equal(chapter.script.segments[1].words[0].start, 3.5);
  assert.equal(chapter.script.cues.keep.speech, undefined);
  const composed = composeChapters(
    mixed.chapters.map(({ id }) => documentChapter(mixed, id, script)),
    { script },
  );
  assert.deepEqual(composed.script.segments, aligned.segments);
  assert.equal(composed.script.duration, aligned.duration);
});

test('a stale narration gap cannot silently discard or overlap an authored silent action', () => {
  const aligned = mixedAlignment();
  aligned.cues['lesson.end'] = { start: 4, end: 4.7 };
  assert.throws(
    () => documentScript(mixed, aligned),
    /Silent action before lesson.end does not fit aligned narration/,
  );
  assert.throws(
    () =>
      documentChapter(
        {
          ...quiet,
          chapters: [
            { ...quiet.chapters[0], beats: [{ id: 'bad', action: 'move', hold: 'wait' }] },
          ],
        },
        'groups',
      ),
    /either a non-empty action or hold/,
  );
});

test('a spoken action reserves its tail before the following silent hold', () => {
  const document = {
    title: 'Движение',
    chapters: [
      {
        id: 'motion',
        title: 'Движение',
        beats: [
          { id: 'move', say: 'Движение.', timing: { delay: 0.5, duration: 4 } },
          { id: 'inspect', hold: 'Рассмотреть результат', seconds: 2 },
          { id: 'finish', say: 'Готово.' },
        ],
      },
    ],
  };
  const projection = documentNarration(document);
  assert.equal(projection.segments[0].pause_after, 6.5);
  // Two one-second clips with exactly the pauses requested before synthesis.
  const secondStart = 1 + projection.segments[0].pause_after;
  const aligned = {
    duration: secondStart + 1 + projection.segments[1].pause_after + projection.outro,
    cues: {
      'motion.move': { start: 0, end: 1, timing: projection.segments[0].cues[0].timing },
      'motion.finish': { start: secondStart, end: secondStart + 1 },
    },
    segments: [
      { id: 'motion.narration-1', start: 0, end: 1, text: 'Движение.' },
      { id: 'motion.narration-2', start: secondStart, end: secondStart + 1, text: 'Готово.' },
    ],
  };
  const script = documentScript(document, aligned);
  assert.deepEqual(script.cues['motion.move'].speech, { start: 0, end: 1 });
  assert.deepEqual(script.cues['motion.inspect'], {
    start: 4.5,
    end: 6.5,
    hold: 'Рассмотреть результат',
  });
  assert.equal(script.cues['motion.finish'].start, secondStart);
  assert.equal(script.segments, aligned.segments, 'acoustic words and times stay unchanged');
  assert.equal(script.cues['motion.inspect'].speech, undefined);
  const chapter = documentChapter(document, 'motion', script);
  assert.doesNotThrow(() => composeChapters([chapter], { script }));
});

test('fractional silent chapter boundaries survive acoustic sample rounding and composition', () => {
  const document = {
    title: 'Граница',
    chapters: [
      {
        id: 'opening',
        title: 'Начало',
        beats: [
          { id: 'one', seconds: 0.1 },
          { id: 'two', seconds: 0.2 },
        ],
      },
      {
        id: 'voice',
        title: 'Речь',
        beats: [
          { id: 'hold', seconds: 0.3 },
          { id: 'say', say: 'Речь.' },
        ],
      },
    ],
  };
  const aligned = {
    duration: 2.2,
    cues: { 'voice.say': { start: 0.6, end: 1 } },
    segments: [{ id: 'voice', start: 0.6, end: 1, text: 'Речь.' }],
  };
  const script = documentScript(document, aligned);
  assert.equal(script.cues.opening.end, script.cues.voice.start);
  assert.equal(script.cues['opening.two'].end, script.cues.voice.start);
  assert.equal(script.cues['voice.hold'].end, script.cues['voice.say'].start);
  const chapters = document.chapters.map(({ id }) => documentChapter(document, id, script));
  const composed = composeChapters(chapters, { script });
  assert.equal(composed.script.segments, aligned.segments);
  assert.deepEqual(composed.script.cues['voice.say'], aligned.cues['voice.say']);
  const overlap = structuredClone(aligned);
  overlap.cues['voice.say'].start = 0.59;
  overlap.segments[0].start = 0.59;
  assert.throws(() => documentScript(document, overlap), /overlaps the preceding action/);
});

test('character actions and prop state survive a score with no visible text', () => {
  const score = compileScore({
    pack: {
      id: 'test',
      actions: { idle: { animation: 'idle' }, point: { animation: 'point' } },
      anchors: {},
      skins: ['hero'],
    },
    set: { width: 800, height: 600, svg: '', spots: { center: { x: 400, y: 500 } } },
    cast: { hero: { skin: 'hero', at: 'center' } },
    props: { dot: { art: { svg: '' }, at: { x: 100, y: 100 }, values: { active: 0 } } },
    beats: [
      {
        id: 'point',
        seconds: 2,
        action: 'Указать на остаток',
        actors: { hero: 'point' },
        props: { dot: { values: { active: 1 } } },
      },
      { id: 'hold', seconds: 3, hold: 'Рассмотреть остаток' },
    ],
  });
  assert.equal(score.script.duration, 5);
  assert.deepEqual(score.script.segments, []);
  assert.deepEqual(score.tracks.hero, [{ start: 0, action: 'point' }]);
  assert.equal(score.propTracks.dot[0].to.values.active, 1);
  assert.equal(score.script.cues.hold.hold, 'Рассмотреть остаток');
});

function alignRequestedNarration(projection) {
  let cursor = projection.intro;
  const cues = {};
  const segments = projection.segments.map((segment) => {
    const start = cursor;
    const end = start + 1;
    for (const cue of segment.cues)
      cues[cue.id] = { start, end, ...(cue.timing ? { timing: cue.timing } : {}) };
    cursor = end + segment.pause_after;
    return { id: segment.id, start, end, text: segment.text };
  });
  return { duration: cursor + projection.outro, cues, segments };
}

for (const following of ['spoken', 'silent', 'end']) {
  test(`a final spoken action reserves its tail before ${following === 'end' ? 'story end' : `the next ${following} chapter`}`, () => {
    const document = {
      title: 'Завершить движение',
      narration: { intro: 0.2, pause: 0.6, outro: 0.3 },
      chapters: [
        {
          id: 'motion',
          title: 'Движение',
          beats: [{ id: 'move', say: 'Движение.', timing: { delay: 0.5, duration: 4 } }],
        },
      ],
    };
    if (following !== 'end')
      document.chapters.push({
        id: 'next',
        title: 'Дальше',
        beats: [
          following === 'spoken'
            ? { id: 'say', say: 'Готово.', timing: { duration: 2 } }
            : { id: 'hold', seconds: 2 },
        ],
      });
    const projection = documentNarration(document);
    assert.equal(projection.segments[0].pause_after, following === 'silent' ? 7.1 : 5.1);
    if (following === 'spoken') assert.equal(projection.segments[1].pause_after, 2.6);
    const aligned = alignRequestedNarration(projection);
    const script = documentScript(document, aligned);
    assert.deepEqual(script.cues['motion.move'].speech, { start: 0.2, end: 1.2 });
    assert.equal(script.cues['motion.move'].end, 4.7);
    assert.equal(script.segments, aligned.segments, 'speech remains at its acoustic anchors');
    assert.equal(script.duration, aligned.duration);
    for (const cue of Object.values(script.cues)) assert.ok(cue.end <= script.duration);
    if (following !== 'end') assert.ok(script.cues.next.start >= script.cues.motion.end);
    assert.doesNotThrow(() =>
      composeChapters(
        document.chapters.map(({ id }) => documentChapter(document, id, script)),
        { script },
      ),
    );
  });
}

test('a spoken tail already reserved before a silent beat is not added again at chapter end', () => {
  const document = {
    title: 'Пауза',
    narration: { pause: 0.6, outro: 0.3 },
    chapters: [
      {
        id: 'motion',
        title: 'Движение',
        beats: [
          { id: 'move', say: 'Движение.', timing: { delay: 0.5, duration: 4 } },
          { id: 'hold', seconds: 2 },
        ],
      },
      { id: 'next', title: 'Далее', beats: [{ id: 'say', say: 'Готово.' }] },
    ],
  };
  const projection = documentNarration(document);
  assert.equal(
    projection.segments[0].pause_after,
    7.1,
    'one action reserve, one silent hold, one chapter pause',
  );
  assert.equal(
    projection.segments[1].pause_after,
    0.6,
    'untimed speech adds only its chapter pause',
  );
  const aligned = alignRequestedNarration(projection);
  assert.equal(aligned.duration, 10);
  const script = documentScript(document, aligned);
  assert.deepEqual(script.cues['motion.hold'], { start: 4.5, end: 6.5 });
  assert.equal(script.cues['next.say'].start, 8.1);
});
