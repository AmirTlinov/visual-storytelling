import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('controller replacement retains prepared experiments, explicit restore time and playback intent', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import {SceneShell} from './src/scene.ts';
        import {story} from './src/story/story.ts';
        import './src/style.css';
        window.ready = SceneShell.ready().then(() => {
          const root = document.querySelector('main');
          const shell = SceneShell.mount(root, {
            title:'Initial title', heading:false,
            parameters:[{key:'count',label:'Count',value:1,min:0,max:10}],
          });
          const rendered=[];
          const create = (chapters = false) => story({
            script:{duration:10,cues:{},segments:chapters ? [
              {id:'first',title:'First chapter',text:'First',start:0,end:5},
              {id:'second',title:'Second chapter',text:'Second',start:5,end:10},
            ] : []},
            exploreTimeline:true,
            stateAt:() => ({count:1}),
            resolveInput:(patch,current)=>({
              values:{count:Math.round(patch.count ?? current.values.count)},
              time:7,
            }),
            render:(state,frame,mode)=>rendered.push({count:state.count,time:frame.time,mode}),
          });
          const controller=create();shell.attachController(controller);
          window.lab={root,shell,scene:root.scene,controller,create,rendered,mount:SceneShell.mount};
        });`,
    },
    outdir: '.',
    bundle: true,
    write: false,
    format: 'iife',
    plugins: [assetURLs()],
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent('<main></main>');
    for (const file of bundle.outputFiles.filter((file) => file.path.endsWith('.css')))
      await page.addStyleTag({ content: file.text });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    await page.evaluate(() => ready);
    assert.deepEqual(
      await page.evaluate(() => ({
        mode: lab.shell.mode,
        time: lab.scene.currentTime,
        count: lab.scene.snapshot().count,
      })),
      { mode: 'story', time: 0, count: 1 },
    );

    const paused = await page.evaluate(async () => {
      lab.shell.input({ count: 7.7 });
      const directInputTime = lab.scene.currentTime;
      lab.scene.seek(2);
      lab.scene.setRate(2);
      const checkpoint = lab.scene.capture();
      lab.scene.seek(9);
      await lab.scene.restore(checkpoint);
      const restoredTime = lab.scene.currentTime;
      const previous = lab.controller;
      const next = lab.create();
      next.restoreInputs(previous.presented.values, { time: 2, mode: 'explore' });
      lab.shell.attachController(next);
      lab.controller = next;
      const state = lab.scene.inspect({ presentation: false });
      let disposed = false;
      try {
        previous.input({ count: 9 });
      } catch {
        disposed = true;
      }
      return {
        directInputTime,
        restoredTime,
        time: state.time,
        mode: state.mode,
        count: state.snapshot.count,
        rate: state.rate,
        playing: state.playing,
        sameHandle: lab.root.scene === lab.scene,
        disposed,
        undo: state.experimentHistory.undo,
        controllerMode: next.requested.mode,
      };
    });
    assert.deepEqual(paused, {
      directInputTime: 7,
      restoredTime: 2,
      time: 2,
      mode: 'explore',
      count: 8,
      rate: 2,
      playing: false,
      sameHandle: true,
      disposed: true,
      undo: true,
      controllerMode: 'explore',
    });

    const playing = await page.evaluate(async () => {
      await lab.scene.play();
      const previous = lab.controller;
      const next = lab.create();
      next.restoreInputs(previous.presented.values, { time: 2, mode: 'explore' });
      lab.shell.attachController(next);
      lab.controller = next;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const state = lab.scene.inspect({ presentation: false });
      lab.scene.pause();
      return {
        rate: state.rate,
        playing: state.playing,
        mode: state.mode,
        count: state.snapshot.count,
      };
    });
    assert.deepEqual(playing, { rate: 2, playing: true, mode: 'explore', count: 8 });

    const title = await page.evaluate(() => {
      lab.shell.setTitle('Updated title', { visible: true });
      const title = document.querySelector('h1').textContent;
      const visible = !document.querySelector('h1').hidden;
      const next = lab.create(true);
      lab.shell.attachController(next);
      lab.shell.setTitle('Underlying title', { visible: false });
      const hidden = document.querySelector('h1').hidden;
      lab.shell.setTitle('Underlying title', { visible: true });
      lab.scene.seek(7);
      return {
        title,
        visible,
        hidden,
        chapter: document.querySelector('h1').textContent,
        chapterMenus: document.querySelectorAll('.ve-chapter-menu').length,
      };
    });
    assert.deepEqual(title, {
      title: 'Updated title',
      visible: true,
      hidden: true,
      chapter: 'Second chapter',
      chapterMenus: 1,
    });
    const preflight = await page.evaluate(async () => {
      const candidate = lab.create(true),
        accepted = lab.scene.currentTime;
      let error;
      try {
        lab.shell.attachController(candidate, () => {
          throw Error('resource adoption failed');
        });
      } catch (cause) {
        error = cause.message;
      }
      candidate.dispose();
      lab.scene.seek(3);
      await lab.scene.ready();
      return {
        error,
        accepted,
        time: lab.scene.currentTime,
        menus: document.querySelectorAll('.ve-chapter-menu').length,
        players: document.querySelectorAll('.vs-player').length,
      };
    });
    assert.deepEqual(preflight, {
      error: 'resource adoption failed',
      accepted: 7,
      time: 3,
      menus: 1,
      players: 1,
    });
    const callbackFailure = await page.evaluate(async () => {
      const root = document.createElement('main');
      document.body.append(root);
      const shell = lab.mount(root, {
        title: 'Callback failure',
        onMode() {
          throw Error('mode notification failed');
        },
      });
      const old = lab.create();
      shell.attachController(old);
      const candidate = lab.create();
      candidate.restoreInputs({ count: 2 }, { time: 2, mode: 'explore' });
      let diagnostic;
      root.addEventListener('scene-callback-error', (event) => (diagnostic = event.detail.message));
      shell.attachController(candidate);
      await root.scene.ready();
      let oldDisposed = false;
      try {
        old.input({ count: 9 });
      } catch {
        oldDisposed = true;
      }
      const result = {
        diagnostic,
        oldDisposed,
        time: root.scene.currentTime,
        players: root.querySelectorAll('.vs-player').length,
      };
      root.scene.dispose();
      root.remove();
      return result;
    });
    assert.deepEqual(callbackFailure, {
      diagnostic: 'mode notification failed',
      oldDisposed: true,
      time: 2,
      players: 1,
    });
    const plainHeading = await page.evaluate(() => {
      lab.shell.attachController(lab.create());
      return {
        text: document.querySelector('h1').textContent,
        menus: document.querySelectorAll('.ve-chapter-menu').length,
        buttons: document.querySelectorAll('h1 button').length,
      };
    });
    assert.deepEqual(plainHeading, { text: 'Underlying title', menus: 0, buttons: 0 });
    const detached = await page.evaluate(async () => {
      const failing = lab.create();
      lab.shell.attachController(failing);
      const dispose = failing.dispose;
      failing.dispose = () => {
        dispose();
        throw Error('cleanup failed');
      };
      let error;
      lab.root.addEventListener('scene-cleanup-error', (event) => (error = event.detail.message), {
        once: true,
      });
      lab.shell.detachController();
      const result = {
        error,
        mode: lab.shell.mode,
        seek: typeof lab.scene.seek,
        playerHidden: document.querySelector('[data-player]').hidden,
      };
      const retry = lab.create();
      lab.shell.attachController(retry);
      await lab.scene.ready();
      return { ...result, retry: typeof lab.scene.seek };
    });
    assert.deepEqual(detached, {
      error: 'cleanup failed',
      mode: 'explore',
      seek: 'undefined',
      playerHidden: true,
      retry: 'function',
    });
  } finally {
    await browser.close();
  }
});
