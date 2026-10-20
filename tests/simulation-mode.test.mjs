import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('simulation handoff cancels a pending intention, preserves refresh, restores only validated state and disposes subscriptions', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import {SceneShell} from './dist/scene.js';
    import {SimulationMode} from './dist/story/simulation-mode.js';
    import {SceneStory} from './dist/story/composition.js';
    import {SimulationPlayer} from './dist/story/simulation.js';
    import './dist/style.css';
    const root=document.querySelector('main'),shell=SceneShell.mount(root,{title:'Mode test',parameters:[{key:'x',label:'X',value:1,min:0,max:10}]});
    let release,physical=0,advances=0;
    const story=shell.attachStory({script:{duration:4,cues:{all:{start:0,end:4}}},stateAt:()=>({x:1}),prepare(values){if(values.x===7)return new Promise(resolve=>release=resolve)},render(){}});
    const scene=root.scene;
    const options={scene,story,element:root.querySelector('[data-player]'),time:()=>physical,snapshot:()=>({physical}),
      checkpoint:{start:()=>({physical:0}),capture:()=>({physical}),validate(v){if(!Number.isFinite(v?.physical)||v.physical<0)throw Error('bad checkpoint')},restore(v){physical=v.physical}},
      model:{read:()=>({value:physical,done:false,stamp:String(physical)}),prepare(){},advance(){physical++;advances++;return true},step(){physical++},render(){},commit(){}}};
    const mode=SimulationMode.mount(options);
    const publicationFailure=async()=>{
      const host=document.createElement('main');document.body.append(host);
      const chapter=id=>({id,title:id,text:id,seconds:2,mount(parent){let physical;return {render(frame){if(id==='bad')throw Error('candidate failed');physical=frame.time},snapshot:()=>({physical}),dispose(){}}}});
      const lesson=await SceneStory.mount(host,{title:'Publication',chapters:[chapter('accepted'),chapter('bad')]});
      const accepted=lesson.presentation;lesson.scene.seek(3);try{await lesson.scene.ready()}catch{}
      const retained=lesson.presentation===accepted;
      let time=0;
      const sim=SimulationMode.mount({...options,scene:lesson.scene,story:lesson.story,element:host.querySelector('[data-player]'),time:()=>time,snapshot:()=>({time}),checkpoint:{start:()=>({physical:lesson.presentation.snapshot().physical}),capture:()=>({physical:time}),validate:options.checkpoint.validate,restore(v){time=v.physical}}});
      await sim.enter();const active=sim.active;lesson.scene.dispose();host.remove();return {retained,active};
    };
    const failedRead=()=>{
      const element=document.createElement('div');root.append(element);
      let fail=true,reads=0,disposed=false;
      const model={...options.model,read(){reads++;if(disposed)throw Error('read after disposal');if(fail){fail=false;throw Error('initial read failed')}return {value:0,done:false,stamp:'0'}}};
      let error;try{SimulationPlayer.mount(element,model)}catch(cause){error=cause.message}
      const empty=element.childElementCount===0;
      const player=SimulationPlayer.mount(element,model);player.dispose();disposed=true;
      const count=reads;
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
      element.remove();return {error,empty,count,reads};
    };
    window.fixture={scene,story,mode,options,publicationFailure,failedRead,createMode:SimulationMode.mount,get physical(){return physical},get advances(){return advances},release(){release?.()}};
  `,
    },
    bundle: true,
    format: 'iife',
    outdir: '.',
    loader: { '.woff2': 'dataurl' },
    write: false,
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent('<main></main>');
    await page.addStyleTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
    });
    const pending = await page.evaluate(async () => {
      const { scene, mode, story } = fixture;
      const change = scene.control([{ type: 'parameters', values: { x: 7 } }]);
      const entering = mode.enter();
      await scene.control([{ type: 'parameters', values: { x: 8 } }]);
      fixture.release();
      await Promise.all([change, entering]);
      return { active: mode.active, x: story.requested.values.x };
    });
    assert.deepEqual(pending, { active: false, x: 8 });
    const state = await page.evaluate(async () => {
      const { mode, scene, story } = fixture;
      await mode.enter();
      await scene.play();
      await new Promise((r) => setTimeout(r, 70));
      scene.pause();
      const saved = scene.capture();
      story.update();
      await story.ready();
      return {
        active: mode.active,
        saved,
        clock: fixture.physical,
        playing: scene.inspect().playing,
      };
    });
    assert(state.active && state.clock > 0 && !state.playing);
    await assert.rejects(
      page.evaluate(
        (c) => fixture.scene.restore({ ...c, simulation: { physical: -1 } }),
        state.saved,
      ),
      /bad checkpoint/,
    );
    assert.equal(await page.evaluate(() => fixture.physical), state.clock);
    const restored = await page.evaluate(async (c) => {
      fixture.mode.leave();
      await fixture.story.ready();
      await fixture.scene.restore(c);
      return fixture.scene.capture();
    }, state.saved);
    assert.deepEqual(restored.simulation, state.saved.simulation);
    await page.evaluate(() => {
      fixture.mode.dispose();
      fixture.scene.play();
    });
    await page.waitForTimeout(50);
    const disposed = await page.evaluate(() => ({
      simulation: fixture.scene.simulation,
      advances: fixture.advances,
      playing: fixture.story.player.state.playing,
    }));
    assert.equal(disposed.simulation, undefined);
    assert(disposed.playing);
    await page.evaluate(() => fixture.scene.pause());
    const rollback = await page.evaluate(async () => {
      let phase = 'story',
        fail = true;
      const options = {
        ...fixture.options,
        onMode(live) {
          phase = live ? 'live' : 'story';
          if (live && fail) {
            fail = false;
            throw Error('failed view');
          }
        },
      };
      // Use the actual exported owner from the fixture, after disposal released its lease.
      const mode = fixture.createMode(options);
      await fixture.scene.play();
      const beforePlaying = fixture.story.player.state.playing;
      let failure;
      try {
        await mode.enter();
      } catch (e) {
        failure = e.message;
      }
      const result = {
        phase,
        active: mode.active,
        playing: fixture.story.player.state.playing,
        beforePlaying,
        failure,
      };
      await mode.enter();
      result.retry = mode.active;
      mode.dispose();
      return result;
    });
    assert.deepEqual(await page.evaluate(() => fixture.publicationFailure()), {
      retained: true,
      active: true,
    });
    assert.deepEqual(rollback, {
      phase: 'story',
      active: false,
      playing: true,
      beforePlaying: true,
      failure: 'failed view',
      retry: true,
    });
    const cleanupFailure = await page.evaluate(async () => {
      let fail = false,
        live;
      const options = {
        ...fixture.options,
        onMode(value) {
          live = value;
        },
        model: {
          ...fixture.options.model,
          read() {
            if (fail) throw Error('failed final read');
            return { value: 0, done: false, stamp: '0' };
          },
        },
      };
      const mode = fixture.createMode(options);
      await mode.enter();
      fail = true;
      let error;
      try {
        mode.leave();
      } catch (cause) {
        error = cause.message;
      }
      const result = {
        error,
        active: mode.active,
        live,
        storyHidden: options.element.hidden,
        liveHidden: options.element.nextElementSibling.hidden,
      };
      fail = false;
      mode.dispose();
      return result;
    });
    assert.deepEqual(cleanupFailure, {
      error: 'failed final read',
      active: false,
      live: false,
      storyHidden: false,
      liveHidden: true,
    });
    const stale = await page.evaluate(async () => {
      const waiting = [];
      let live = false;
      const options = {
        ...fixture.options,
        onMode(value) {
          live = value;
        },
        story: {
          ...fixture.story,
          ready() {
            return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
          },
        },
      };
      const mode = fixture.createMode(options);
      const first = mode.enter().catch((error) => error.message);
      const second = mode.enter();
      waiting[1].resolve();
      await second;
      const entered = mode.active;
      waiting[0].reject(Error('stale failure'));
      const failure = await first;
      const result = { entered, active: mode.active, live, failure };
      mode.dispose();
      const disposedWaiting = [];
      let callbacks = 0;
      const disposedMode = fixture.createMode({
        ...fixture.options,
        onMode() {
          callbacks++;
        },
        story: {
          ...fixture.story,
          ready() {
            return new Promise((resolve, reject) => disposedWaiting.push({ resolve, reject }));
          },
        },
      });
      const pending = disposedMode.enter().catch((error) => error.message);
      disposedMode.dispose();
      const afterDispose = callbacks;
      disposedWaiting[0].reject(Error('late disposal failure'));
      await pending;
      return { ...result, afterDispose, callbacks };
    });
    assert.deepEqual(stale, {
      entered: true,
      active: true,
      live: true,
      failure: 'stale failure',
      afterDispose: 1,
      callbacks: 1,
    });
    await page.evaluate(() => fixture.scene.dispose());
    const count = await page.evaluate(() => fixture.advances);
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => fixture.advances), count);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const failure = await page.evaluate(() => fixture.failedRead());
    assert.equal(failure.error, 'initial read failed');
    assert.equal(failure.empty, true);
    assert.equal(failure.reads, failure.count);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
