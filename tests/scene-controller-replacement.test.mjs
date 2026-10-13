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
          window.lab={root,shell,scene:root.scene,controller,create,rendered};
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
  } finally {
    await browser.close();
  }
});
