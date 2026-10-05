import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderer } from '../tools/render.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('a responsive character host keeps SVG, Spine and Ink aligned through paused resize and book capture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'character-camera-'));
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
          import './src/style.css';
          const host=document.querySelector('#responsive'),fixedHost=document.querySelector('#fixed');
          const set=arrange(readingRoom({width:1200}),{objects:{
            board:{kind:'board',at:{x:1.4,z:3.7},scale:1.1},
          }});
          const options={pack:chibi,set,cast:{hero:{skin:'tesla',at:{x:-2.3,z:1.4},scale:.8}},
            props:{marker:{art:{svg:'<circle r="8" fill="#e32434"/>'},at:{x:500,y:370}}},
            beats:[{id:'look',text:'The same world',seconds:4,shot:{focus:['hero','board.content'],framing:'wide'}}],
            surfaces:{board:{title:'Camera alignment',size:{width:400,height:200},create(view){
              view.layer.innerHTML='<rect width="400" height="200" fill="#238cc7"/><circle cx="200" cy="100" r="48" fill="#ffdf73"/>';
              return {render(){}};
            }}}};
          window.galleryReady=Promise.all([
            CharacterStage.mount(host,{...options,camera:'responsive'}),CharacterStage.mount(fixedHost,options),
          ]).then(([stage,fixed])=>{
            stage.render(1.2);fixed.render(1.2);
            const inspect=()=>{
              const state=stage.snapshot(),aperture=host.querySelector('.ve-character-aperture');
              const box=aperture.getBoundingClientRect(),canvas=aperture.querySelector('canvas[data-review-id=cast]');
              const marker=aperture.querySelector('[data-review-id=marker]');
              const p=new DOMPoint(0,0).matrixTransform(marker.getScreenCTM());
              const surface=aperture.querySelector('[data-surface=board]'),matrix=new DOMMatrix(surface.style.transform);
              const errors=[[0,0],[400,0],[400,200],[0,200]].map(([x,y],i)=>{
                const q=new DOMPoint(x,y).matrixTransform(matrix),world=state.surfaces.board.quad[i];
                return Math.hypot(q.x/q.w-(world.x-state.camera.x)*box.width/state.camera.width,
                  q.y/q.w-(world.y-state.camera.y)*box.height/state.camera.height);
              });
              return {state,width:box.width,height:box.height,canvasWidth:canvas.width,canvasHeight:canvas.height,errors,
                markerError:Math.hypot(p.x-box.left-(500-state.camera.x)*box.width/state.camera.width,
                  p.y-box.top-(370-state.camera.y)*box.height/state.camera.height),
                fixed:{camera:fixed.snapshot().camera,rect:fixedHost.querySelector('.ve-character-aperture').getBoundingClientRect().toJSON()}};
            };
            window.lab={stage,fixed,inspect,resize(width,height){host.style.width=width+'px';host.style.height=height+'px';},
              async capture(){
                const before=stage.snapshot(),camera={x:0,y:0,width:set.width,height:set.height};
                const pending=stage.capture({camera});
                const restored=JSON.stringify(before)===JSON.stringify(stage.snapshot());
                const [image,expected]=await Promise.all([pending,fixed.capture({camera})]);
                const a=image.getContext('2d').getImageData(0,0,image.width,image.height).data;
                const b=expected.getContext('2d').getImageData(0,0,expected.width,expected.height).data;
                let error=0;for(let i=0;i<a.length;i++)error+=Math.abs(a[i]-b[i]);
                const live=await stage.capture(),ctx=live.getContext('2d');
                return {restored,width:image.width,height:image.height,error:error/a.length,
                  alpha:[[0,0],[live.width-1,0],[0,live.height-1],[live.width-1,live.height-1]].map(([x,y])=>ctx.getImageData(x,y,1,1).data[3])};
              },dispose(){stage.dispose();fixed.dispose();return host.childElementCount+fixedHost.childElementCount;}};
          });
        `,
      },
      bundle: true,
      write: false,
      outdir: '.',
      format: 'iife',
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><head><link rel="stylesheet" href="style.css"></head><body style="margin:0"><div id="responsive" style="position:relative;width:360px;height:760px"></div><div id="fixed" style="position:absolute;left:-10000px;top:0;width:360px;height:760px"></div><script src="index.js"></script>',
    );
    for (const output of bundle.outputFiles)
      await writeFile(
        join(directory, output.path.endsWith('.css') ? 'style.css' : 'index.js'),
        output.text,
      );
    capture = await renderer({ directory, width: 1000, controls: true });
    const check = (value, width, height) => {
      assert.equal(value.width, width);
      assert.equal(value.height, height);
      assert.ok(
        Math.abs(value.state.camera.width / value.state.camera.height - width / height) < 1e-12,
      );
      assert.ok(Math.abs(value.canvasWidth / value.canvasHeight - width / height) < 0.002);
      assert.ok(value.errors.every((error) => error < 0.001));
      assert.ok(value.markerError < 0.001);
      assert.deepEqual(value.state.framing.clipped, []);
      assert.equal(value.state.time, 1.2);
    };
    const portrait = await capture.page.evaluate(() => window.lab.inspect());
    check(portrait, 360, 760);
    assert.equal(portrait.fixed.rect.width, 360);
    assert.equal(portrait.fixed.rect.height, 195);
    assert.ok(
      Math.abs(portrait.fixed.camera.width / portrait.fixed.camera.height - 1200 / 650) < 1e-12,
    );
    const book = await capture.page.evaluate(() => window.lab.capture());
    assert.equal(book.restored, true);
    assert.equal(book.width, 1200);
    assert.equal(book.height, 650);
    assert.ok(book.error < 0.02, `book capture changes registered layers by ${book.error}/255`);
    assert.deepEqual(book.alpha, [255, 255, 255, 255]);
    const artifacts = fileURLToPath(
      new URL('../artifacts/polish/responsive-camera/', import.meta.url),
    );
    await mkdir(artifacts, { recursive: true });
    await capture.page.locator('#responsive').screenshot({ path: join(artifacts, 'portrait.png') });
    await capture.page.evaluate(() => window.lab.resize(920, 400));
    await capture.page.waitForFunction(
      () =>
        Math.abs(
          window.lab.inspect().state.camera.width / window.lab.inspect().state.camera.height - 2.3,
        ) < 1e-8,
    );
    const wide = await capture.page.evaluate(() => window.lab.inspect());
    check(wide, 920, 400);
    await capture.page.locator('#responsive').screenshot({ path: join(artifacts, 'wide.png') });
    const reset = await capture.page.evaluate(() => {
      const previous = window.lab.stage.snapshot().camera;
      window.lab.stage.focus(['hero.face']);
      const close = window.lab.stage.snapshot().camera;
      window.lab.stage.reset();
      return { previous, close, after: window.lab.stage.snapshot().camera };
    });
    assert.notDeepEqual(reset.close, reset.previous);
    assert.deepEqual(reset.after, reset.previous);
    await capture.page.evaluate(() => window.lab.resize(360, 760));
    await capture.page.waitForFunction(
      () =>
        window.lab.inspect().state.camera.width / window.lab.inspect().state.camera.height < 0.5,
    );
    const rewound = await capture.page.evaluate(() => window.lab.inspect());
    check(rewound, 360, 760);
    assert.deepEqual(rewound.state, portrait.state);
    assert.equal(await capture.page.evaluate(() => window.lab.dispose()), 0);
  } finally {
    await capture?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
