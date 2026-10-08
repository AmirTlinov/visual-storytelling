import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serve } from '../tools/site.mjs';

test('scene owners preserve detail framing, readable cells, atomic input and restored values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-runtime-'));
  let browser, server;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import './dist/style.css';
          import {SceneShell, surface, token, plot, portion, widgetState} from './dist/index.js';
          import {Viewport3D, ThreeKit as T} from './dist/viewport/index.js';
          window.galleryReady = (async () => {
            await SceneShell.ready();
            const root = document.querySelector('main'), events = [];
            const shell = SceneShell.mount(root, {title:'Detail',paper:false,
              parameters:[{key:'x',label:'X',value:0,min:0,max:10}],onMode:mode=>events.push(mode)});
            const view = Viewport3D.mount(shell.stage); shell.attachView(view);
            const whole = new T.Group(), detail = new T.Mesh(new T.BoxGeometry(1,1,1));
            const distant = new T.Mesh(new T.BoxGeometry(1,1,1)); distant.position.x=100;
            whole.add(detail,distant); view.setObject(whole);
            view.shot({target:detail,direction:[0,0,1],padding:36});
            const left = new T.Vector3(-.5,0,0).project(view.camera), right = new T.Vector3(.5,0,0).project(view.camera);
            const detailWidth = (right.x-left.x)*shell.stage.clientWidth/2;
            for (const color of ['blue','orange','purple','green','red','yellow'])
              for (const variant of ['', '-wash','-soft']) view.ink(new T.MeshBasicMaterial(),color+variant);
            const model = {fraction:0};
            const pigment = view.ink(new T.MeshBasicMaterial(), p=>p.blue.clone().lerp(p.surface,model.fraction));
            detail.material = pigment;
            let invalidColor;
            try { view.ink(new T.MeshBasicMaterial(),'unknown'); } catch(error) { invalidColor=error.message; }
            const paper = surface(shell.actions,{id:'cells',width:500,height:250,title:'Cells',description:'Fitting and axes'});
            const cell = token(paper,'number','42'); cell.at(80,80);
            const shortWidth = cell.label.width;
            cell.label.text('123456');
            const overflow = cell.label.element.dataset.layoutError;
            cell.label.text('7');
            const cleared = !cell.label.element.dataset.layoutError;
            const wide = token(paper,'wide','123456',{width:140});
            const chart = plot(paper,'axis',{x:180,y:30,width:200,height:180,xDomain:[0,2],yDomain:[-1,1],xTicks:[{value:1,label:'1'}]});
            const tick = paper.element.querySelector('[data-stroke="axis:xtick:1"]').getBBox();
            let renders=0, disposed=0;
            const story = shell.attachStory({script:{duration:10,cues:{},segments:[
              {id:'first',title:'First question',text:'First',start:0,end:5},
              {id:'second',title:'Second question',text:'Second',start:5,end:10}
            ]},stateAt:()=>({x:0}),render:()=>renders++});
            events.length=0; renders=0;
            shell.setMode('explore');
            const transition = {events:[...events],renders,mode:story.requested.mode};
            shell.onDispose(()=>disposed++);
            window.lab={shell,story,view,detail,events,model,pigment,paper,chart,portion,disposeCount:()=>disposed};
            return {detailWidth,shortWidth,overflow,cleared,wideWidth:wide.label.width,
              wideError:wide.label.element.dataset.layoutError,invalidColor,transition,
              axisY:chart.point(0,0)[1],tickY:tick.y+tick.height/2};
          })();
          window.echoTrial = () => {
            const cases = [{modelContent:{value:1}}, {privateContent:[1,2]}, {privateContent:null},
              {privateContent:17}, {privateContent:{__visualStory:'author value',value:1}}];
            return cases.map((snapshot,i) => {
              const receipts=[],restores=[];
              window.openai={setWidgetState:value=>receipts.push(structuredClone(value))};
              const bridge=widgetState('echo-'+i,value=>restores.push(value));
              bridge.save(snapshot); const latest={...snapshot,modelContent:{value:2}}; bridge.save(latest);
              for(const widgetState of [...receipts].reverse())
                window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{widgetState}}}));
              const ownEchoes=restores.length;
              window.openai.widgetState=receipts.at(-1);
              const read=bridge.read(); bridge.dispose();
              const next=widgetState('echo-'+i,value=>restores.push(value));
              const external={modelContent:{value:3},privateContent:{__visualStory:'author value',value:42}};
              window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{widgetState:external}}}));
              next.dispose(); delete window.openai;
              return {ownEchoes,read,latest,restores,external};
            });
          };`,
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'index.js'),
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="index.css"></head><body class="ve-standalone"><main class="ve-scene"></main><script src="index.js"></script></body></html>',
    );
    server = await serve(directory);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 960, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url);
    const result = await page.evaluate(() => window.galleryReady);
    assert(result.detailWidth > 200, `detail was only ${result.detailWidth}px wide`);
    assert(result.shortWidth <= 32.5);
    assert.match(result.overflow, /Enlarge its cell/);
    assert(result.cleared);
    assert(result.wideWidth <= 128.5 && !result.wideError);
    assert.match(result.invalidColor, /Unknown 3D pigment: unknown/);
    assert(Math.abs(result.tickY - result.axisY) < 1);
    const plotLifecycle = await page.evaluate(() => {
      const { chart, paper } = lab;
      const trace = chart.trace(
        'сигнал (x)',
        [
          [0, -1],
          [1, 0],
          [2, 1],
        ],
        'blue',
      );
      trace.at(1, 0);
      const part = lab.portion(paper, 'доля (x)', { x: 40, y: 30, size: 40, pigment: 'orange' });
      part.set(0.5);
      const clipping = [trace.element, part.element].every(
        (element) => getComputedStyle(element.querySelector('[data-stroke]')).clipPath !== 'none',
      );
      part.dispose();
      const withinChart = chart.element.contains(trace.element);
      const ids = [...chart.element.querySelectorAll('[id]')].map((e) => e.id);
      chart.show(false);
      const hidden = getComputedStyle(chart.element).display === 'none';
      chart.show(true);
      trace.show(false);
      const traceHidden = getComputedStyle(trace.element).display === 'none';
      trace.show(true);
      const visible = getComputedStyle(trace.element).display !== 'none';
      const cursor = trace.element.querySelector('[data-plot-point]');
      const position = [Number(cursor.getAttribute('cx')), Number(cursor.getAttribute('cy'))];
      trace.dispose();
      const recreated = chart.trace(
        'сигнал (x)',
        [
          [0, 0],
          [2, 1],
        ],
        'orange',
      );
      recreated.at(2, 1);
      chart.dispose();
      return {
        withinChart,
        clipping,
        uniqueIds: ids.length === new Set(ids).size,
        hidden,
        traceHidden,
        visible,
        position,
        expected: chart.point(1, 0),
        removed: !recreated.element.isConnected,
        remaining: paper.element.querySelectorAll('[data-object^="axis"]').length,
      };
    });
    assert.deepEqual(plotLifecycle, {
      withinChart: true,
      clipping: true,
      uniqueIds: true,
      hidden: true,
      traceHidden: true,
      visible: true,
      position: [280, 120],
      expected: [280, 120],
      removed: true,
      remaining: 0,
    });
    assert.deepEqual(result.transition, { events: ['explore'], renders: 1, mode: 'explore' });
    // The same model-derived pigment survives input and a theme change while paused.
    await page.evaluate(() => {
      lab.model.fraction = 0.75;
      lab.view.invalidate();
    });
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction(() =>
        lab.pigment.color.equals(
          lab.view.palette.blue.clone().lerp(lab.view.palette.surface, 0.75),
        ),
      );
    }
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.locator('h1').innerText(), 'Detail');
    for (const result of await page.evaluate(() => window.echoTrial())) {
      assert.equal(result.ownEchoes, 0);
      assert.deepEqual(result.read, result.latest);
      assert.deepEqual(result.restores, [result.external]);
    }
    await page.locator('[data-mode="story"]').click();
    assert(await page.getByRole('combobox', { name: 'Глава', exact: true }).isVisible());
    await page.locator('[data-mode="explore"]').click();
    assert.equal(await page.locator('h1').innerText(), 'Detail');
    await page.getByRole('slider', { name: 'X', exact: true }).fill('4');
    assert.equal(await page.evaluate(() => lab.story.requested.values.x), 4);
    assert.deepEqual(await page.evaluate(() => lab.events), ['explore', 'story', 'explore']);
    await page.evaluate(() => lab.story.seek(7));
    assert.equal(
      await page.getByRole('combobox', { name: 'Глава', exact: true }).innerText(),
      'Second question',
    );
    await page.evaluate(() => {
      lab.shell.dispose();
      lab.shell.dispose();
    });
    assert.equal(await page.evaluate(() => lab.disposeCount()), 1);
    assert.equal(await page.locator('main').textContent(), '');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
