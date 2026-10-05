import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assetURLs } from '../tools/asset-urls.mjs';
import { renderer } from '../tools/render.mjs';

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
            focus(ids){if(ids[0]!=='cube'+index)throw new Error('Wrong focus owner');focused=index},
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
