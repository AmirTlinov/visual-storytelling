import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderer } from '../tools/render.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('external time keeps one live SVG through notebook entry, resize, reverse seek and return', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notebook-presentation-'));
  let capture;
  try {
    const bundle = await build({
      plugins: [assetURLs()],
      stdin: {
        resolveDir: fileURLToPath(new URL('../', import.meta.url)),
        contents: `
          import {CharacterStage,chibi,readingRoom,arrange} from '@visual-storytelling/core/characters';
          import {NotebookPresentation} from '@visual-storytelling/core/book';
          import './src/style.css';
          const host=document.querySelector('#scene');
          let renders=0,creates=0,clicks=0;
          const options={pack:chibi,camera:'responsive',
            set:arrange(readingRoom({theme:'laboratory'}),{objects:{book:{open:new URL(location.href).searchParams.has('closed')?0:1}}}),
            cast:{hero:{skin:'tesla',at:'entry',scale:.8}},
            beats:[{id:'trace',text:'Рисунок продолжает появляться на странице',seconds:10}],
            surfaces:{book:{title:'Живое наблюдение',size:{width:640,height:320},create(view){
              creates++; view.grid({step:20});
              view.layer.innerHTML='<path d="M50 160H590" fill="none" stroke="var(--ve-blue)" stroke-width="5"/><circle data-charge cy="160" r="18" fill="var(--ve-orange)"/><circle data-button cx="500" cy="230" r="22" fill="var(--ve-purple)" tabindex="0"/><text x="320" y="55" text-anchor="middle" fill="var(--ve-ink)" font-size="28">Живое наблюдение</text>';
              const dot=view.layer.querySelector('[data-charge]');let time;
              view.layer.querySelector('[data-button]').addEventListener('click',()=>clicks++);
              return {render(frame){renders++;time=frame.time;dot.setAttribute('cx',String(80+48*time));},snapshot(){return {time};}};
            }}}};
          window.galleryReady=(async()=>{
            const pool=await CharacterStage.mountMany(host,[options,{...options,surfaces:undefined}]);
            const stage=pool.render(0,0);
            const original=host.querySelector('[data-surface=book] > svg');
            const entry=await NotebookPresentation.mount(host,{source:stage,book:'book',topic:'Наблюдение'});
            window.lab={stage,entry,
              sample(time,progress,reduced=false,index=0){
                pool.render(index,time,reduced);
                if(progress===null) entry.hide();else entry.render(progress,reduced);
                return this.inspect();
              },
              inspect(){const svg=host.querySelector('[data-surface=book] > svg');
                const dot=svg.querySelector('[data-charge]');const box=dot.getBoundingClientRect();
                const surface=svg.parentElement; const frame=host.getBoundingClientRect();
                return {presentation:entry.snapshot(),same:svg===original,creates,renders,clicks,
                  charge:Number(dot.getAttribute('cx')),visible:svg.checkVisibility({visibilityProperty:true}),
                  inPresentation:!!svg.closest('[data-notebook-presentation]'),
                  box:{x:box.x-frame.x,y:box.y-frame.y,width:box.width,height:box.height},
                  viewBox:svg.getAttribute('viewBox'),theme:surface.dataset.theme,
                  ink:getComputedStyle(surface).color,
                  grid:svg.querySelector('.vs-grid path').getAttribute('d'),
                  stages:[...host.querySelectorAll('.ve-character-stage')].map(el=>({hidden:el.hidden,visibility:el.style.visibility})),
                  shells:document.querySelectorAll('.ve-player').length};
              },
              dispose(){entry.dispose();entry.dispose();pool.dispose();return host.childElementCount;}};
          })();`,
      },
      bundle: true,
      write: false,
      outdir: '.',
      format: 'iife',
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><head><link rel="stylesheet" href="style.css"></head><body class="ve-standalone" style="margin:0"><div id="scene" style="width:100vw;height:650px;position:relative"></div><script src="index.js"></script>',
    );
    for (const output of bundle.outputFiles)
      await writeFile(
        join(directory, output.path.endsWith('.css') ? 'style.css' : 'index.js'),
        output.text,
      );
    capture = await renderer({ directory, width: 960, controls: true });
    const sample = (time, progress, reduced = false, index = 0) =>
      capture.page.evaluate((args) => window.lab.sample(...args), [time, progress, reduced, index]);
    const inspect = () => capture.page.evaluate(() => window.lab.inspect());
    const artifacts = fileURLToPath(
      new URL('../artifacts/notebook-presentation/', import.meta.url),
    );
    await mkdir(artifacts, { recursive: true });
    let previous;
    for (const [name, time, progress] of [
      ['start', 0, 0],
      ['orbit', 3, 0.77],
      ['live-trace', 5, 0.89],
      ['paper', 6, 1],
    ]) {
      const state = await sample(time, progress);
      assert.equal(state.same, true);
      assert.equal(state.creates, 1, 'the drawing has one model throughout the transition');
      assert.equal(state.shells, 0, 'the host keeps its existing player');
      assert.equal(state.presentation.content.time, time);
      assert.equal(
        state.charge,
        80 + 48 * time,
        'the trace samples external time during the orbit',
      );
      assert.equal(state.inPresentation, true);
      assert.equal(state.visible, true);
      if (previous) assert.ok(state.renders > previous.renders);
      previous = state;
      await capture.page.locator('#scene').screenshot({ path: join(artifacts, name + '.png') });
    }
    const before = await sample(6, 1 - 1e-6),
      after = await sample(6, 1);
    assert.ok(
      Math.hypot(before.box.x - after.box.x, before.box.y - after.box.y) < 0.01,
      'arriving preserves drawing coordinates',
    );
    assert.ok(Math.abs(after.box.width / after.box.height - 1) < 0.001, 'a circle stays round');
    await capture.page.locator('[data-button]').click();
    assert.equal(
      (await inspect()).clicks,
      1,
      'DOM listeners and input survive the camera transfer',
    );
    for (const width of [375, 1280]) {
      await capture.page.setViewportSize({ width, height: 900 });
      await capture.page.emulateMedia({ colorScheme: width === 375 ? 'dark' : 'light' });
      await sample(7, 1);
      await capture.page
        .locator('#scene')
        .screenshot({ path: join(artifacts, 'paper-' + width + '.png') });
      const state = await inspect();
      assert.equal(state.ink, width === 375 ? 'rgb(238, 236, 231)' : 'rgb(41, 39, 36)');
      assert.ok(Math.abs(state.box.width / state.box.height - 1) < 0.001);
      assert.ok(state.box.x >= 0 && state.box.x + state.box.width <= width);
      assert.ok(state.box.y >= 0 && state.box.y + state.box.height <= 650);
      const approaching = await sample(7, 1 - 1e-6),
        arrived = await sample(7, 1);
      assert.ok(
        Math.hypot(approaching.box.x - arrived.box.x, approaching.box.y - arrived.box.y) < 0.05,
        `the final viewport change preserves coordinates at ${width}: ${JSON.stringify([approaching.box, arrived.box])}`,
      );
      const rewind = await sample(3, 0.77);
      assert.equal(rewind.presentation.content.time, 3);
      assert.equal(rewind.same, true);
      const reduced = await sample(7, 0.2, true);
      assert.equal(reduced.presentation.progress, 1);
      assert.equal(reduced.charge, 416);
    }
    await capture.page.evaluate(
      () => (document.querySelector('#scene').style.colorScheme = 'dark'),
    );
    assert.equal(
      (await sample(7, 1)).ink,
      'rgb(238, 236, 231)',
      'an explicit host theme overrides the system preference',
    );
    await capture.page.evaluate(() => (document.querySelector('#scene').style.colorScheme = ''));
    const returned = await sample(2, null);
    assert.equal(returned.inPresentation, false);
    assert.equal(returned.visible, true);
    assert.equal(returned.viewBox, '0 0 640 320');
    assert.equal(returned.theme, 'light', 'the physical book restores its theme');
    assert.equal(returned.charge, 176);
    const lending = await capture.page.evaluate(async () => {
      const { stage } = window.lab;
      const before = await stage.capture();
      const host = document.createElement('div');
      document.body.append(host);
      const lease = stage.presentSurface('book', host);
      lease.theme('dark');
      lease.project(
        [
          { x: 0, y: 0 },
          { x: 320, y: 0 },
          { x: 320, y: 640 },
          { x: 0, y: 640 },
        ],
        0.5,
      );
      const surface = host.querySelector('[data-surface]'),
        svg = surface.querySelector('svg');
      const frozen = () => [
        svg.getAttribute('viewBox'),
        surface.dataset.theme,
        document.querySelector('.ve-character-stage').style.visibility,
      ];
      const expected = frozen(),
        pending = stage.capture(),
        restored = frozen();
      const after = await pending;
      const a = before.getContext('2d').getImageData(0, 0, before.width, before.height).data;
      const b = after.getContext('2d').getImageData(0, 0, after.width, after.height).data;
      let changed = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
      let competing = false;
      try {
        stage.presentSurface('book', host);
      } catch {
        competing = true;
      }
      lease.release();
      const next = stage.presentSurface('book', host);
      lease.release();
      const hidden = document.querySelector('.ve-character-stage').style.visibility;
      next.release();
      host.remove();
      return { changed, expected, restored, competing, hidden };
    });
    assert.equal(
      lending.changed,
      0,
      'capturing the source during a loan must preserve its world pixels',
    );
    assert.deepEqual(
      lending.restored,
      lending.expected,
      'capture restores borrowed layout synchronously',
    );
    assert.equal(lending.competing, true);
    assert.equal(
      lending.hidden,
      'hidden',
      'a stale release must not reveal an active presentation',
    );
    await sample(4, 0.8);
    const other = await sample(1, null, false, 1);
    assert.equal(other.stages[0].hidden, true);
    assert.equal(
      other.stages[1].hidden,
      false,
      'returning the drawing must not reactivate a different chapter',
    );
    assert.equal((await sample(8, 1)).presentation.content.time, 8);
    assert.deepEqual(
      capture.messages.filter((message) => message.type === 'error'),
      [],
    );
    assert.equal(
      await capture.page.evaluate(() => {
        window.lab.stage.dispose();
        return window.lab.dispose();
      }),
      0,
      'disposing the source with a lent drawing is safe',
    );
    await capture.page.goto(capture.page.url() + '?closed');
    await capture.page.evaluate(() => window.galleryReady);
    const covered = await sample(1, 0.3);
    assert.equal(covered.visible, false, 'the cover must occlude its live page');
    const revealed = await sample(4, 0.8);
    assert.equal(revealed.visible, true);
    assert.equal(revealed.charge, 272, 'the drawing keeps external time while its cover opens');
    await capture.page.locator('#scene').screenshot({ path: join(artifacts, 'opening-live.png') });
    await sample(0, null);
    const instant = await sample(5, 0, true);
    assert.equal(instant.visible, true);
    assert.equal(
      instant.charge,
      320,
      'reduced entry renders a closed book current drawing immediately',
    );
    assert.equal(await capture.page.evaluate(() => window.lab.dispose()), 0);
  } finally {
    await capture?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
