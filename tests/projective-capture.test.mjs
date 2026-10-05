import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderer } from '../tools/render.mjs';

test('projected capture preserves flat pigment and transparency without a tessellation grid', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projective-capture-'));
  let capture;
  try {
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../', import.meta.url)),
        contents: `
      import {paintPlane,projective} from './src/ink/projective.ts';
      window.galleryReady=Promise.resolve();
      window.probe=()=>{
        const source=document.createElement('canvas');source.width=128;source.height=96;
        const pigment=source.getContext('2d');pigment.fillStyle='rgba(48,96,144,.5)';pigment.fillRect(0,0,128,96);
        return [
          [{x:17,y:12},{x:263,y:12},{x:263,y:222},{x:17,y:222}],
          [{x:45,y:12},{x:263,y:40},{x:219,y:222},{x:1,y:194}],
          [{x:53,y:14},{x:261,y:49},{x:238,y:213},{x:8,y:234}],
          [{x:-63,y:-14},{x:261,y:49},{x:238,y:213},{x:-38,y:294}],
        ].map(quad=>{
          const result=document.createElement('canvas');result.width=280;result.height=250;
          const c=result.getContext('2d');paintPlane(c,source,quad);
          const data=c.getImageData(0,0,280,250).data,map=projective(quad,128,96),samples=[];
          for(let y=0;y<250;y++)for(let x=0;x<280;x++){
            const local=map.inverse(x+.5,y+.5);
            if(local.x<6||local.y<6||local.x>122||local.y>90)continue;
            samples.push(data[(y*280+x)*4+3]);
          }
          document.body.append(result);
          return {min:Math.min(...samples),max:Math.max(...samples),count:samples.length};
        });
      };`,
      },
      bundle: true,
      write: false,
      format: 'iife',
    });
    await writeFile(join(directory, 'index.js'), bundle.outputFiles[0].text);
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><body><main class="ve-scene"></main><script src="index.js"></script>',
    );
    capture = await renderer({ directory, width: 960, controls: true });
    const samples = await capture.page.evaluate(() => window.probe());
    for (const sample of samples) {
      assert.ok(sample.count > 10000);
      assert.ok(sample.min >= 126 && sample.max <= 130, JSON.stringify(sample));
    }
  } finally {
    await capture?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
