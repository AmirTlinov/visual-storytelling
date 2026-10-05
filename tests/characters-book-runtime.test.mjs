import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderer } from '../tools/render.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('an open book keeps its live drawing on the table, through closeup, retake and rewind', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'open-book-'));
  let capture;
  try {
    const bundle = await build({
      plugins: [assetURLs()],
      stdin: {
        resolveDir: fileURLToPath(new URL('../', import.meta.url)),
        contents: `
          import {CharacterStage} from './src/characters/stage.ts';
          import {chibi} from './src/characters/packs/chibi.ts';
          import {readingRoom} from './src/characters/staging/sets.ts';
          import {arrange} from './src/characters/staging/layout.ts';
          import {compileScore} from './src/characters/score.ts';
          import './src/style.css';
          const host=document.querySelector('#scene');
          const set=arrange(readingRoom({theme:'laboratory',perspective:'overview',width:1680}),{
            objects:{seat:null,plant:null,sideTable:{at:{x:-1.55,z:3.8},scale:.96}},
            spots:{reader:{of:'sideTable',side:'left',gap:.55,offset:{x:0,z:.7}}},
          });
          const options={pack:chibi,set,
            cast:{hero:{skin:'tesla',at:'reader',scale:.68,holding:'book'}},
            beats:[
              {id:'open',text:'Раскрыть книгу',perform:[{action:'openBook',actor:'hero',book:'book'}]},
              {id:'read',text:'Рассмотреть схему',perform:[{action:'read',actor:'hero',book:'book',pages:1}]},
              {id:'put',text:'Оставить раскрытой',perform:[{action:'put',actor:'hero',onto:'sideTable'}]},
              {id:'away',text:'Отойти',perform:[{action:'walk',actor:'hero',to:'entry'}]},
              {id:'detail',text:'Рисунок остаётся на странице',seconds:3,shot:{focus:['book.content'],framing:'detail'}},
              {id:'take',text:'Взять раскрытой',perform:[{action:'take',actor:'hero',object:'book'}]},
              {id:'close',text:'Закрыть',perform:[{action:'closeBook',actor:'hero',book:'book'}]},
              {id:'return',text:'Вернуть закрытой',perform:[{action:'put',actor:'hero',onto:'sideTable'}]},
              {id:'finish',text:'Книга закрыта',seconds:2},
            ].map(beat=>({shot:{focus:['hero','book','sideTable'],framing:'medium'},...beat})),
            surfaces:{book:{title:'Живой рисунок на странице',size:{width:480,height:320},create(view){
              view.layer.innerHTML='<path d="M60 100H420V240H60Z M80 260H400" fill="none" stroke="#2369b4" stroke-width="5"/><circle cx="350" cy="170" r="35" fill="#edbd64" stroke="#b56a30" stroke-width="4"/><text x="240" y="52" text-anchor="middle" fill="#273d42" font-size="27">Наблюдение в тетради</text><circle data-charge cy="100" r="8" fill="#b56a30"/>';
              const dot=view.layer.querySelector('[data-charge]');let time;
              return {render(frame,viewport){time=frame.time;dot.setAttribute('cx',String(100+240*(time%2)/2));
                window.drawingFrame=frame;window.drawingViewport={...viewport};window.drawingRenders=(window.drawingRenders??0)+1;
              },snapshot(){return {time};}};
            }}}};
          const score=compileScore(options);
          const put=score.blocking.plans.find(plan=>plan.action.action==='put');
          const placing=put.start+(put.end-put.start)*(put.timing.rise+put.timing.approach+put.timing.engage+put.timing.act/2)/Object.values(put.timing).reduce((a,b)=>a+b,0);
          window.galleryReady=CharacterStage.mount(host,options).then(stage=>{
            window.lab={stage,cues:score.script.cues,placing,approach:put.to.hero.at,support:set.staging.objects.sideTable.at,
              sample(time,reduced=false){stage.render(time,reduced);return stage.snapshot();},
              inspect(){const surface=host.querySelector('[data-surface=book]');return {
                state:stage.snapshot(),resting:stage.restingBook('book'),hidden:surface.hidden,
                charge:Number(surface.querySelector('[data-charge]').getAttribute('cx')),
              };},
              async presentations(){
                const parent=document.createElement('div');document.body.append(parent);
                const results=[];
                for(const [width,height]of [[375,812],[1280,720],[375,812]]){
                  stage.render(score.script.cues.away.end-.001);
                  const presentation=stage.presentSurface('book',parent);
                  const quad=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
                  const frame=window.drawingFrame,before=window.drawingRenders;
                  presentation.project(quad,width/height);
                  const projected={...window.drawingViewport},renders=window.drawingRenders-before;
                  const sameFrame=window.drawingFrame===frame;
                  const repeated=window.drawingRenders;
                  presentation.project(quad,width/height);
                  const sameProjectionRenders=window.drawingRenders-repeated;
                  stage.render(score.script.cues.away.end-.5);
                  const during={...window.drawingViewport},time=window.drawingFrame.time;
                  const svg=parent.querySelector('svg'),original=svg.outerHTML;
                  await stage.capture();
                  const captureRestored=svg.outerHTML===original;
                  presentation.release();
                  results.push({width,height,projected,renders,sameFrame,sameProjectionRenders,during,time,captureRestored,
                    released:{...window.drawingViewport}});
                }
                parent.remove();return results;
              },
              dispose(){stage.dispose();return host.childElementCount;}};
          });`,
      },
      bundle: true,
      write: false,
      outdir: '.',
      format: 'iife',
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><head><link rel="stylesheet" href="style.css"></head><body style="margin:0"><div id="scene" style="width:960px;height:650px;position:relative"></div><script src="index.js"></script>',
    );
    for (const output of bundle.outputFiles)
      await writeFile(
        join(directory, output.path.endsWith('.css') ? 'style.css' : 'index.js'),
        output.text,
      );
    capture = await renderer({ directory, width: 960, controls: true });
    const { cues, placing, approach, support } = await capture.page.evaluate(() => ({
      cues: window.lab.cues,
      placing: window.lab.placing,
      approach: window.lab.approach,
      support: window.lab.support,
    }));
    assert.ok(
      approach.z <= support.z,
      'the original film arrangement resolves to a visible contact',
    );
    const sample = (time) => capture.page.evaluate((time) => window.lab.sample(time), time);
    const initial = await sample(0);
    assert.equal(initial.world.objects.book, 0);
    assert.equal(initial.surfaces.book.visible, false);
    const held = await sample(cues.put.start);
    assert.equal(held.world.objects.book, 1);
    const edge = [await sample(cues.put.end - 1e-6), await sample(cues.put.end)];
    assert.ok(edge[0].world.items.hero);
    assert.equal(edge[1].world.items.hero, undefined);
    for (const [i, p] of edge[0].surfaces.book.quad.entries()) {
      const q = edge[1].surfaces.book.quad[i];
      assert.ok(
        Math.hypot(p.x - q.x, p.y - q.y) < 0.001,
        'release must not move or flip the drawing',
      );
    }
    const artifacts = fileURLToPath(new URL('../artifacts/open-book/', import.meta.url));
    await mkdir(artifacts, { recursive: true });
    const states = [];
    for (const [name, time] of [
      ['held', cues.read.start + 0.5],
      ['placing', placing],
      ['resting', cues.away.end - 1e-6],
      ['closeup', cues.detail.end - 0.25],
      ['retaken', cues.take.end],
    ]) {
      const state = await sample(time);
      assert.equal(state.world.objects.book, 1);
      assert.equal(state.surfaces.book.visible, true, name);
      assert.equal(state.surfaces.book.content.time, time, 'the resting drawing remains live');
      for (const contact of state.world.actors.hero.contacts)
        assert.ok(
          contact.error < 1,
          name + ': ' + contact.kind + ' contact error ' + contact.error,
        );
      states.push([time, state]);
      if (name === 'resting' || name === 'closeup') {
        const inspection = await capture.page.evaluate(() => window.lab.inspect());
        assert.equal(inspection.resting.open, 1);
        assert.equal(inspection.hidden, false);
        assert.equal(state.world.items.hero, undefined);
        assert.ok(state.bounds['book.content'] ?? state.details['book.content']);
        if (name === 'closeup') assert.deepEqual(state.framing.clipped, []);
      }
      await capture.page.locator('#scene').screenshot({ path: join(artifacts, name + '.png') });
    }
    const closed = await sample(cues.finish.start);
    assert.equal(closed.world.objects.book, 0);
    assert.equal(closed.surfaces.book.visible, false);
    assert.equal((await capture.page.evaluate(() => window.lab.inspect())).resting.open, 0);
    assert.equal(closed.bounds['book.content'] ?? closed.details['book.content'], undefined);
    for (const [time, expected] of states.reverse()) {
      await capture.page.evaluate((time) => window.lab.sample(time, true), time);
      assert.deepEqual(
        await sample(time),
        expected,
        'reduced motion and reverse seek restore the same book',
      );
    }
    for (const result of await capture.page.evaluate(() => window.lab.presentations())) {
      const width = Math.max(480, (320 * result.width) / result.height);
      const expected = { width, height: (width * result.height) / result.width };
      for (const key of ['width', 'height']) {
        assert.ok(Math.abs(result.projected[key] - expected[key]) < 1e-9);
        assert.equal(
          result.during[key],
          result.projected[key],
          'the next frame retains the presented viewport',
        );
      }
      assert.equal(result.renders, 1, 'a new aperture reflows its current frame immediately');
      assert.equal(result.sameFrame, true);
      assert.equal(
        result.sameProjectionRenders,
        0,
        'moving the same plane does not repeat authored work',
      );
      assert.equal(result.time, cues.away.end - 0.5);
      assert.equal(result.captureRestored, true);
      assert.deepEqual(result.released, { width: 480, height: 320 });
    }
    assert.deepEqual(
      capture.messages.filter((message) => message.type === 'error'),
      [],
    );
    assert.equal(await capture.page.evaluate(() => window.lab.dispose()), 0);
  } finally {
    await capture?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
