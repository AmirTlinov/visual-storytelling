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

test('each boundary owns its transition duration and retains reversible local time', () => {
  const chapters = ['room', 'paper', 'next'].map((id) => ({ id, title: id, text: id, seconds: 3 }));
  const plan = composeChapters(chapters, { transition: (index) => (index === 1 ? 4.2 : 1.1) });
  assert.deepEqual(
    plan.timings.map((t) => t.transition),
    [0, 4.2, 1.1],
  );
  assert.deepEqual(
    [3, 5, 7.2, 8.2, 7.2].map((t) => +chapterTime(plan.timings[1], t).toFixed(8)),
    [0, 0, 0, 1, 0],
  );
  assert.throws(() => composeChapters(chapters, { transition: () => NaN }), /non-negative/);
});

test('full-page capture preserves portrait and wide paper while the notebook shot survives resize', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notebook-capture-'));
  let capture;
  try {
    const bundle = await build({
      plugins: [assetURLs()],
      stdin: {
        contents: `
          import { inkChapter } from './dist/story/ink-chapter.js';
          import { Viewport3D } from './dist/viewport/three.js';
          import { Box3, Vector3, PerspectiveCamera } from './dist/viewport/engine.js';
          import { notebookCamera } from './dist/book/camera.js';
          import { notebookPageAspect } from './dist/characters/staging/notebook.js';
          import './dist/style.css';
          const host=document.querySelector('#paper'), stage=document.querySelector('#stage');
          const frame={time:0,progress:0,mode:'story',reduced:false,values:{}};
          window.galleryReady=inkChapter({id:'ink',title:'Ink',text:'Ink',seconds:1,
            size:{width:640,height:250},grid:{step:30,x:5,y:7},
            create(view) {
              window.surface=view;
              view.layer.innerHTML='<rect x="200" y="80" width="100" height="40" fill="#b4141e"/>';
              return {render(){},dispose(){window.removed=true;}};
            },
          }).mount(host).then(presentation=>{
            const view=Viewport3D.mount(stage);
            view.controls.enabled=false;
            const source={width:960,height:650,camera:{x:100,y:40,width:700,height:530},
              projection:{center:480,horizon:270,floor:610,unit:100,distance:12},
              book:{kind:'book',at:{x:2,z:3,height:1.5},scale:.8}};
            const current=notebookCamera(source,.55);
            window.proof=async()=>{
              const frames=[], pending=[];
              for(const [width,height] of [[440,1000],[900,600]]) {
                host.style.width=width+'px'; host.style.height=height+'px';
                presentation.render(frame);
                const before=window.surface.element.outerHTML;
                const {x,y,width:w,height:h}=window.surface.element.viewBox.baseVal;
                const image=presentation.capture({aspect:notebookPageAspect});
                const restored=before===window.surface.element.outerHTML;
                const fullW=Math.max(w,h*notebookPageAspect),fullH=fullW/notebookPageAspect;
                const left=x+(w-fullW)/2,top=y+(h-fullH)/2;
                pending.push(image.then(canvas=>({
                  width:canvas.width,height:canvas.height,
                  pixel:[...canvas.getContext('2d').getImageData(Math.round((250-left)*2),Math.round((100-top)*2),1,1).data],
                })));
                frames.push({restored,w,h,fullW,fullH,aspect:width/height});
              }
              const original=window.surface.element.outerHTML;
              let error;
              try {window.surface.withViewport(.7,()=>{throw new Error('capture failed');});}
              catch(e){error=e.message;}
              const restoredAfterError=original===window.surface.element.outerHTML;
              const invalid=[0,NaN,-1].map(aspect=>{
                try{window.surface.withViewport(aspect,()=>{});return false;}catch{return true;}
              });
              // Switch from an ordinary page-turn camera to the pinhole owner, then resize while paused.
              view.shot({target:new Box3(new Vector3(-5,-3,0),new Vector3(5,3,0)),direction:[0,0,1],padding:0,reduced:false});
              view.shot(current.project);
              const cameraFrames=[];
              for(const [width,height] of [[440,1000],[900,600],[440,1000]]) {
                stage.style.width=width+'px';stage.style.height=height+'px';
                await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                const expected=new PerspectiveCamera(); current.project(expected,width,height);
                cameraFrames.push({actual:[...view.camera.matrixWorld.elements,...view.camera.projectionMatrix.elements],
                  expected:[...expected.matrixWorld.elements,...expected.projectionMatrix.elements]});
              }
              view.camera.position.set(100,100,100);view.reset();
              const reset=[...view.camera.position];
              // Captures are already frozen; disposing the live owners cannot invalidate their inputs.
              presentation.dispose();view.dispose();
              return {frames,images:await Promise.all(pending),error,restoredAfterError,invalid,cameraFrames,reset,
                removed:window.removed,children:host.childElementCount+stage.childElementCount};
            };
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
      '<!doctype html><head><link rel="stylesheet" href="style.css"></head><main id="paper" style="position:relative;width:440px;height:1000px"></main><div id="stage" style="position:relative;width:900px;height:600px"></div><script src="index.js"></script>',
    );
    for (const output of bundle.outputFiles)
      await writeFile(
        join(root, output.path.endsWith('.css') ? 'style.css' : 'index.js'),
        output.text,
      );
    capture = await renderer({ directory: root, controls: true, width: 1000 });
    const result = await capture.page.evaluate(() => window.proof());
    for (const [i, frame] of result.frames.entries()) {
      assert.equal(frame.restored, true);
      assert.equal(result.images[i].width, Math.round(frame.fullW * 2));
      assert.equal(result.images[i].height, Math.round(frame.fullH * 2));
      assert.deepEqual(result.images[i].pixel, [180, 20, 30, 255]);
      // The final camera crops the full physical sheet to exactly the preceding live aperture.
      // SVGAnimatedRect exposes float32 coordinates, so compare below a thousandth of a pixel.
      assert.ok(Math.abs(Math.min(frame.fullW, frame.fullH * frame.aspect) - frame.w) < 1e-4);
      assert.ok(Math.abs(Math.min(frame.fullH, frame.fullW / frame.aspect) - frame.h) < 1e-4);
    }
    assert.equal(result.error, 'capture failed');
    assert.equal(result.restoredAfterError, true);
    assert.deepEqual(result.invalid, [true, true, true]);
    for (const frame of result.cameraFrames)
      frame.actual.forEach((value, i) => assert.ok(Math.abs(value - frame.expected[i]) < 1e-12));
    assert.deepEqual(result.reset, result.cameraFrames.at(-1).expected.slice(12, 15));
    assert.equal(result.removed, true);
    assert.equal(result.children, 0);
  } finally {
    await capture?.close();
    await rm(root, { recursive: true, force: true });
  }
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
