import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { composeChapters, chapterTime } from '../dist/story/composition-plan.js';
import { renderer } from '../tools/render.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('narrated local cues retain intervening pauses, words and reversible chapter time', () => {
  const chapter = {
    id: 'model',
    title: 'Модель',
    text: 'Два действия',
    seconds: 4,
    script: {
      duration: 4,
      cues: { first: { start: 0, end: 2 }, second: { start: 2, end: 4 } },
      segments: [
        {
          id: 'speech',
          start: 0,
          end: 4,
          text: 'Первое второе',
          words: [
            { text: 'Первое', start: 0, end: 2 },
            { text: 'второе', start: 2, end: 4 },
          ],
        },
      ],
    },
  };
  const script = {
    duration: 9,
    cues: {
      model: { start: 1, end: 9 },
      'model.first': { start: 2, end: 4 },
      'model.second': { start: 6, end: 8 },
    },
  };
  const plan = composeChapters([chapter], {
    introduction: { seconds: 1, id: 'opening', title: 'Model', text: 'Introduction' },
    script,
  });
  assert.equal(plan.script.cues.opening.action, 'Introduction');
  assert.equal(plan.script.cues['book-open'], undefined);
  assert.doesNotThrow(() => composeChapters([{ ...chapter, id: 'book-open' }]));
  assert.deepEqual(
    [7, 0, 5, 3, 9, 1, 8].map((time) => chapterTime(plan.timings[0], time)),
    [3, 0, 2, 1, 4, 0, 4],
  );
  assert.deepEqual(
    plan.script.segments
      .find((s) => s.id === 'model.speech')
      .words.map(({ start, end }) => [start, end]),
    [
      [2, 4],
      [6, 8],
    ],
  );
  const changed = (cues) => ({ ...script, cues: { ...script.cues, ...cues } });
  assert.throws(
    () => composeChapters([chapter], { script: changed({ 'model.second': { start: 3, end: 8 } }) }),
    /change order/,
  );
  assert.throws(
    () => composeChapters([chapter], { script: changed({ 'model.first': { start: 0, end: 4 } }) }),
    /outside its chapter/,
  );
  assert.throws(
    () =>
      composeChapters([
        { ...chapter, id: 'a', script: { duration: 4, cues: { 'b.c': { start: 0, end: 4 } } } },
        { ...chapter, id: 'a.b', script: { duration: 4, cues: { c: { start: 0, end: 4 } } } },
      ]),
    /collides/,
  );
});

test('boundary capture, fast theme changes and disposal preserve the current presentation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'composition-capture-'));
  let capture;
  try {
    const bundle = await build({
      plugins: [assetURLs()],
      stdin: {
        contents: `
      import { SceneStory } from './dist/story/composition.js';
      import { snapshotSVG } from './dist/export/index.js';
      import './dist/style.css';
      const root = document.querySelector('main');
      window.removed = [];
      const chapter = id => ({ id, title:id, text:id, seconds:2,
        mount(parent) {
          const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
          svg.setAttribute('viewBox','0 0 80 60');
          svg.innerHTML='<rect y="0" width="20" height="20" style="fill:light-dark(rgb(180,20,30),rgb(20,170,220))"/>';
          parent.append(svg); let frame;
          return {
            render(value) { frame=value; svg.firstChild.setAttribute('x', String(value.progress * 40)); },
            snapshot: () => ({time:frame.time, mode:frame.mode}),
            capture() { const pending = snapshotSVG(svg,1); return pending.then(image => new Promise(resolve => setTimeout(() => resolve(image),12))); },
            dispose() { window.removed.push(id); svg.remove(); },
          };
        },
      });
      window.galleryReady = SceneStory.mount(root, { title:'Composition', chapters:[chapter('a'),chapter('b')], frame:{width:80,height:60},
        transition: { duration:0, mount(parent, previews) {
          return { render(state) { window.boundaries = previews.map(pair => ['start','end'].map((key,i) => Array.from(pair[key].getContext('2d').getImageData(i?45:5,5,1,1).data))); window.transitionState=state; }, dispose() { window.removed.push('transition'); } };
        } },
      }).then(value => window.lab=value);
    `,
        resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      },
      bundle: true,
      write: false,
      outdir: '.',
      format: 'iife',
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><head><link rel="stylesheet" href="style.css"></head><main class="ve-scene"></main><script src="index.js"></script>',
    );
    for (const output of bundle.outputFiles)
      await writeFile(
        join(root, output.path.endsWith('.css') ? 'style.css' : 'index.js'),
        output.text,
      );
    // The owner controls all time; the fixture only exposes its native API to the existing renderer.
    capture = await renderer({ directory: root, controls: true, width: 400 });
    const result = await capture.page.evaluate(async () => {
      const scene = window.lab.scene;
      scene.seek(0.5);
      const before = scene.snapshot();
      const a = scene.setTheme('dark'),
        b = scene.setTheme('light'),
        c = scene.setTheme('dark');
      scene.seek(3);
      await Promise.all([a, b, c]);
      const after = scene.snapshot(),
        boundaries = window.boundaries,
        transition = window.transitionState;
      const pending = scene.setTheme('light');
      scene.dispose();
      await pending;
      return {
        before,
        after,
        boundaries,
        transition,
        removed: window.removed,
        children: document.querySelector('main').childElementCount,
      };
    });
    assert.equal(result.before.content.time, 0.5);
    assert.equal(result.after.chapter, 'b');
    assert.equal(result.after.content.time, 1);
    assert.equal(result.transition.chapter, 1);
    assert.deepEqual(
      result.boundaries,
      Array.from({ length: 2 }, () => [
        [20, 170, 220, 255],
        [20, 170, 220, 255],
      ]),
    );
    assert.deepEqual(result.removed, ['a', 'b', 'transition']);
    assert.equal(result.children, 0);
  } finally {
    await capture?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('shared character chapters capture their own dimensions and keep the active inspector', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cast-capture-'));
  let capture;
  try {
    const bundle = await build({
      plugins: [assetURLs()],
      stdin: {
        contents: `
      import { CharacterStage } from './dist/characters/stage.js';
      import { chibi } from './dist/characters/packs/chibi.js';
      import './dist/style.css';
      const parent = document.querySelector('main');
      const chapter = (width,height,color) => ({ pack:chibi,
        set:{width,height,spots:{},svg:'<rect x="-1000" y="-1000" width="4000" height="4000" fill="'+color+'"/>'},
        cast:{hero:{skin:'tesla',at:{x:width/2,y:height*.9},scale:.2}},
        beats:[{id:'idle',text:'Idle',seconds:1}],
      });
      window.galleryReady = CharacterStage.mountMany(parent,[chapter(320,240,'#b4141e'),chapter(240,320,'#14aadc')]).then(sequence => {
        window.sequence=sequence;
      });
    `,
        resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      },
      bundle: true,
      write: false,
      outdir: '.',
      format: 'iife',
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><head><link rel="stylesheet" href="style.css"></head><main style="width:500px;height:400px;position:relative"></main><script src="index.js"></script>',
    );
    for (const output of bundle.outputFiles)
      await writeFile(
        join(root, output.path.endsWith('.css') ? 'style.css' : 'index.js'),
        output.text,
      );
    capture = await renderer({ directory: root, controls: true, width: 500 });
    const result = await capture.page.evaluate(async () => {
      const sequence = window.sequence,
        a = sequence.render(0, 0);
      const first = a.capture();
      const b = sequence.render(1, 0),
        active = sequence.canvas.__visualReview;
      const second = b.capture();
      const layout = [];
      for (const index of [0, 1, 0, 1]) {
        sequence.render(index, 0.5);
        const visible = [...document.querySelector('main').children].filter(
          (element) => !element.hidden,
        );
        layout.push({ count: visible.length, top: visible[0]?.getBoundingClientRect().top });
      }
      a.dispose();
      const keepsInspector = active === sequence.canvas.__visualReview;
      const images = await Promise.all([first, second]);
      const results = images.map((c) => ({
        width: c.width,
        height: c.height,
        pixel: [...c.getContext('2d').getImageData(5, 5, 1, 1).data],
      }));
      sequence.dispose();
      sequence.dispose();
      return {
        results,
        layout,
        keepsInspector,
        children: document.querySelector('main').childElementCount,
      };
    });
    assert.deepEqual(result.results, [
      { width: 320, height: 240, pixel: [180, 20, 30, 255] },
      { width: 240, height: 320, pixel: [20, 170, 220, 255] },
    ]);
    assert.equal(result.keepsInspector, true);
    assert.ok(result.layout.every((frame) => frame.count === 1));
    assert.ok(result.layout.every((frame) => frame.top === result.layout[0].top));
    assert.equal(result.children, 0);
  } finally {
    await capture?.close();
    await rm(root, { recursive: true, force: true });
  }
});
