import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assetURLs } from '../tools/asset-urls.mjs';
import { renderer } from '../tools/render.mjs';
import { chromium } from 'playwright';

test('a superseded chapter cancels its resource request before the next mount and disposal aborts pending work', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import {SceneStory,inkChapter} from './dist/story/index.js';
        import './dist/style.css';
        const events=[];
        const chapters=['a','b','c'].map(id=>inkChapter({id,title:id,text:id,seconds:1,
          async create(view,signal){
            events.push('create '+id);
            if(id==='b')await new Promise((resolve,reject)=>{
              // A resource that completes only through cancellation. C cannot wait for its success.
              signal.addEventListener('abort',()=>{events.push('abort '+id);reject(signal.reason)},{once:true});
            });
            return{render(){view.layer.textContent=id},dispose(){events.push('dispose '+id)}};
          },
        }));
        window.events=events;
        window.galleryReady=SceneStory.mount(document.querySelector('main'),{title:'Cancellation',chapters}).then(lab=>window.lab=lab);
      `,
    },
    bundle: true,
    write: false,
    outdir: '.',
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<main class="ve-scene"></main>');
    await page.addStyleTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    await page.evaluate(() => window.galleryReady);
    await page.evaluate(() => lab.scene.seek(1.2));
    await page.waitForFunction(() => events.includes('create b'));
    const pending = await page.evaluate(() => ({
      rendering: lab.scene.inspect().rendering,
      checkpoint: lab.scene.capture(),
    }));
    assert.equal(pending.rendering.requested.values.chapter, 'b');
    assert.equal(pending.rendering.presented.values.chapter, 'a');
    assert.equal(pending.checkpoint.values.chapter, 'a');
    await page.evaluate(async () => {
      lab.scene.seek(2.2);
      await lab.scene.ready();
    });
    assert.deepEqual(await page.evaluate(() => events.slice()), [
      'create a',
      'create b',
      'abort b',
      'create c',
    ]);
    assert.equal(await page.evaluate(() => lab.scene.snapshot().chapter), 'c');
    assert.equal(await page.locator('[data-chapter="b"]').count(), 0);
    await page.evaluate(() => lab.scene.seek(1.2));
    await page.waitForFunction(() => events.filter((event) => event === 'create b').length === 2);
    await page.evaluate(() => lab.scene.dispose());
    await page.waitForFunction(() => events.filter((event) => event === 'abort b').length === 2);
    assert.equal(await page.locator('[data-chapter]').count(), 0);
    assert.deepEqual(
      await page.evaluate(() => events.filter((event) => event.startsWith('dispose'))),
      ['dispose a', 'dispose c'],
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('cold and reverse chapter seeks await bounded GPU owners, including export and agent controls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'composition-lifecycle-'));
  let capture;
  try {
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import {SceneStory} from './dist/story/composition.js';
      import {Viewport3D} from './dist/viewport/three.js';
      import * as T from './dist/viewport/engine.js';
      import './dist/style.css';
      const records=[],live=new Set(),losses=[];let maximum=0,focused;
      const chapters=Array.from({length:24},(_,index)=>({id:'c'+index,title:'Chapter '+index,text:'Chapter '+index,seconds:1,
        async mount(parent){
          const view=Viewport3D.mount(parent),record={index,view,parent,disposed:false};
          records.push(record);live.add(record);maximum=Math.max(maximum,live.size);
          view.renderer.domElement.addEventListener('webglcontextlost',()=>{if(!record.disposed)losses.push(index)});
          view.setObject(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial({color:0xdd3355})));
          await new Promise(resolve=>setTimeout(resolve,index===23?90:3));
          let frame;
          return {
            render(value){frame=value;view.invalidate()},
            snapshot(){return{index,progress:frame.progress}},
            view:{focus(ids){if(ids[0]!=='cube'+index)throw new Error('Wrong focus owner');focused=index},reset:view.reset,capture:view.capture,restore:view.restore},
            dispose(){record.disposed=true;live.delete(record);view.dispose()},
          };
        }
      }));
      window.galleryReady=SceneStory.mount(document.querySelector('main'),{title:'Lifecycle',chapters,frame:{width:320,height:200}}).then(result=>{
        window.lab={...result,info:()=>({mounted:records.length,live:live.size,maximum,chapter:[...live].find(record=>!record.parent.hidden)?.parent.dataset.chapter,
          domCanvases:document.querySelectorAll('.ve-stage canvas').length,losses:[...losses],focused,
          lostLive:[...live].filter(r=>r.view.renderer.getContext().isContextLost()).map(r=>r.index)}),
          pixel:()=>{const record=[...live].find(r=>!r.parent.hidden),v=record.view,g=v.renderer.getContext();
            v.renderer.render(v.scene,v.camera);const rgba=new Uint8Array(4);
            g.readPixels(g.drawingBufferWidth/2,g.drawingBufferHeight/2,1,1,g.RGBA,g.UNSIGNED_BYTE,rgba);
            return [...rgba];
          }
        };
      });
    `,
      },
      bundle: true,
      write: false,
      outdir: '.',
      format: 'iife',
      loader: { '.woff2': 'dataurl' },
      plugins: [assetURLs()],
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><head><link rel="stylesheet" href="style.css"></head><main class="ve-scene"></main><script src="index.js"></script>',
    );
    for (const output of bundle.outputFiles)
      await writeFile(
        join(directory, output.path.endsWith('.css') ? 'style.css' : 'index.js'),
        output.text,
      );
    capture = await renderer({ directory, controls: true, width: 640 });
    const startup = await capture.page.evaluate(() => lab.info());
    assert.equal(startup.mounted, 1);
    assert.equal(startup.live, 1);
    await capture.seek(23.5);
    assert.deepEqual(
      await capture.page.evaluate(() => ({ info: lab.info(), pixel: lab.pixel() })),
      {
        info: {
          mounted: 2,
          live: 2,
          maximum: 2,
          chapter: 'c23',
          domCanvases: 2,
          losses: [],
          focused: undefined,
          lostLive: [],
        },
        pixel: [221, 51, 85, 255],
      },
    );
    const result = await capture.page.evaluate(async () => {
      lab.scene.seek(12.5);
      await new Promise((resolve) => setTimeout(resolve, 1));
      lab.scene.seek(18.5);
      lab.scene.seek(0.5);
      await lab.scene.ready();
      const rapid = lab.info();
      await lab.scene.control([
        { type: 'seek', time: 17.5 },
        { type: 'focus', ids: ['cube17'] },
      ]);
      const controlled = lab.info();
      for (let i = 0; i < 24; i++) {
        lab.scene.seek(i + 0.5);
        await lab.scene.ready();
      }
      lab.scene.seek(0.5);
      await lab.scene.ready();
      const reverse = lab.info(),
        pixel = lab.pixel();
      lab.scene.dispose();
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { rapid, controlled, reverse, pixel, disposed: lab.info() };
    });
    assert.equal(result.rapid.chapter, 'c0');
    assert.equal(result.controlled.chapter, 'c17');
    assert.equal(result.controlled.focused, 17);
    assert.equal(result.reverse.chapter, 'c0');
    assert(result.reverse.maximum <= 3);
    assert.deepEqual(result.reverse.losses, []);
    assert.deepEqual(result.reverse.lostLive, []);
    assert.deepEqual(result.pixel, [221, 51, 85, 255]);
    assert.equal(result.disposed.live, 0);
    assert.equal(result.disposed.domCanvases, 0);
  } finally {
    await capture?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
