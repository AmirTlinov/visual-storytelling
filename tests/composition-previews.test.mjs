import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';

test('boundary snapshots wait for each drawing paint and cancellation cannot publish an old canvas', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import {chapterPreviews} from './dist/story/composition-previews.js';
    import {describeObject,sceneObjects} from './dist/scene-objects.js';
    window.pendingPreview=(failedRestore=false)=>{
      const parent=document.querySelector('main'),wait=[],records=[];
      parent.replaceChildren();
      const chapters=['accepted','candidate'].map(id=>({id,seconds:5,script:{duration:5,cues:{}}}));
      const items=chapters.map((chapter,index)=>{
        const element=document.createElement('div');element.dataset.chapter=chapter.id;Object.assign(element.style,{position:'absolute',inset:'0'});element.hidden=index===1;parent.append(element);
        const text=document.createElement('span');text.dataset.object='same';element.append(text);
        let state=2;
        const release=describeObject(text,{label:'Accepted object',interactive:false,value:()=>({state})});
        const drawing={render(frame){state=frame.time;text.textContent=chapter.id+':'+state},ready(){return new Promise((resolve,reject)=>wait.push({resolve,reject}))},capture(){},snapshot:()=>({state})};
        drawing.render({time:2});return {element,drawing,release};
      });
      const objects=sceneObjects(parent);
      let failRestore=failedRestore;const previews=chapterPreviews(chapters,parent,{},index=>items[index],()=>{if(failRestore)throw Error('accepted restore failed');items[0].drawing.render({time:2})});
      const promise=previews.prepare(1,new AbortController().signal).catch(error=>({message:error.message,causes:error.errors?.map(cause=>cause.message)}));
      window.pendingLab={wait,promise,items,accept(){items[0].drawing.render({time:2});previews.accept()},read:()=>({frozen:parent.querySelector('[data-presentation-frozen]')?.textContent,objects:objects.objects(),unconcealed:items.filter(item=>!item.element.hidden && !item.element.style.clipPath).map(item=>item.element.textContent)}),dispose(){previews.dispose();objects.dispose();items.forEach(item=>item.release());parent.replaceChildren()}};
    };
    window.run=async(cancel)=>{
      const abort=new AbortController(), captures=[], hidden=[], parent=document.querySelector('main');
      const chapters=['before','after'].map(id=>({id,seconds:5,script:{duration:5,cues:{}}}));
      const mounted=chapters.map(chapter=>{
        const element=document.createElement('div');element.hidden=true;parent.append(element);
        let requested,painted=-1;
        return {element,drawing:{render(frame){requested=frame.time},async ready(){await Promise.resolve();painted=requested;if(cancel)abort.abort(Error('cancel'))},capture(){captures.push(painted);return document.createElement('canvas')}}};
      });
      let restored=0;const owner=chapterPreviews(chapters,parent,{},i=>mounted[i],()=>restored++);
      let error;try{await owner.prepare(1,abort.signal)}catch(e){error=e.message}
      const result={captures,restored,error,ready:owner.has(1),hidden:mounted.map(x=>x.element.hidden)};
      owner.dispose();mounted.forEach(x=>x.element.remove());return result;
    };
  `,
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent('<main style="width:500px;height:300px"></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => pendingPreview());
    await page.waitForFunction(() => pendingLab.wait.length === 1);
    let held = await page.evaluate(() => pendingLab.read());
    assert.equal(held.frozen, 'accepted:2');
    assert.deepEqual(held.unconcealed, []);
    assert.deepEqual(
      held.objects.map((object) => object.value),
      [{ state: 2 }],
    );
    await page.evaluate(() => pendingLab.wait[0].resolve());
    await page.waitForFunction(() => pendingLab.wait.length === 2);
    held = await page.evaluate(() => pendingLab.read());
    assert.equal(held.frozen, 'accepted:2');
    assert.deepEqual(held.unconcealed, []);
    assert.deepEqual(
      held.objects.map((object) => object.value),
      [{ state: 2 }],
    );
    const failed = await page.evaluate(async () => {
      pendingLab.wait[1].reject(Error('candidate paint failed'));
      const error = await pendingLab.promise;
      return { error, ...pendingLab.read() };
    });
    assert.equal(failed.error.message, 'candidate paint failed');
    assert.equal(failed.frozen, undefined);
    assert.deepEqual(failed.unconcealed, ['accepted:2']);
    assert.deepEqual(
      failed.objects.map((object) => object.value),
      [{ state: 2 }],
    );
    await page.evaluate(() => pendingLab.dispose());
    await page.evaluate(() => pendingPreview(true));
    await page.waitForFunction(() => pendingLab.wait.length === 1);
    await page.evaluate(() => pendingLab.wait[0].resolve());
    await page.waitForFunction(() => pendingLab.wait.length === 2);
    const twice = await page.evaluate(async () => {
      pendingLab.wait[1].reject(Error('candidate paint failed'));
      const error = await pendingLab.promise;
      return { error, ...pendingLab.read() };
    });
    assert.deepEqual(twice.error.causes, ['candidate paint failed', 'accepted restore failed']);
    assert.equal(twice.frozen, 'accepted:2');
    assert.deepEqual(twice.unconcealed, []);
    assert.deepEqual(
      twice.objects.map((object) => object.value),
      [{ state: 2 }],
    );
    await page.evaluate(() => pendingLab.accept());
    assert.equal((await page.evaluate(() => pendingLab.read())).frozen, undefined);
    await page.evaluate(() => pendingLab.dispose());
    await page.evaluate(() => pendingPreview());
    await page.waitForFunction(() => pendingLab.wait.length === 1);
    await page.evaluate(() => pendingLab.dispose());
    assert.equal(await page.locator('[data-presentation-frozen]').count(), 0);
    await page.evaluate(async () => {
      pendingLab.wait[0].reject(Error('disposed paint'));
      await pendingLab.promise;
    });
    assert.equal(await page.locator('[data-presentation-frozen]').count(), 0);
    assert.deepEqual(await page.evaluate(() => run(false)), {
      captures: [5, 0],
      error: undefined,
      restored: 1,
      ready: true,
      hidden: [true, true],
    });
    assert.deepEqual(await page.evaluate(() => run(true)), {
      captures: [],
      restored: 1,
      error: 'cancel',
      ready: false,
      hidden: [true, true],
    });
  } finally {
    await browser.close();
  }
});
