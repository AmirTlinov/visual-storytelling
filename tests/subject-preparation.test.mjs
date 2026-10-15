import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('static and timed subject candidates retain the accepted model and drawing on cancellation and rollback failure', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
 import {IllustratedStory} from './dist/story/illustrated.js';
 import './dist/style.css';
 window.flags={};
 const model={validateInputs:({value})=>({value}),state:({value})=>({value}),operations:{double:s=>({value:s.value*2})},validateViews(){},focusTargets:()=>[]};
 const subject={title:'Counter',parameters:m=>[{key:'value',label:'Value',value:m.inputs.value,min:0,max:10}],create(viewport){
  const mark=document.createElement('span');viewport.stage.append(mark);
  return {validate(){},render(m,v,state){mark.textContent=state.value;if(flags.abort && state.value===4) flags.abort.abort(Error('cancelled after render'));},snapshot:s=>s,
   ready(){if(flags.failCandidate && ['4','8'].includes(mark.textContent))throw Error('candidate paint failed');if(flags.failRollback && mark.textContent==='6')throw Error('rollback paint failed');},dispose(){mark.remove()}};
 }};
 window.ready=IllustratedStory.mount(document.querySelector('main'),{document:{version:2,models:[{id:'counter',module:'counter',inputs:{value:3}}],views:[],chapters:[{id:'double',title:'Double',beats:[{id:'action',seconds:2,operation:{model:'counter',name:'double'}}]}]},modules:{counter:model},subjects:{counter:subject}}).then(r=>window.lab=r);
 `,
    },
    bundle: true,
    write: false,
    outdir: '.',
    format: 'iife',
    plugins: [assetURLs()],
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent('<body><main class="ve-scene"></main>');
    await page.addStyleTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
    });
    await page.evaluate(() => window.ready);
    const result = await page.evaluate(async () => {
      const scene = lab.scene,
        author = scene.authoring,
        baseline = author.document;
      const attempt = async (kind, abort) => {
        const doc = structuredClone(baseline);
        doc.models[0].inputs.value = 4;
        if (kind === 'static') doc.chapters = [];
        const controller = new AbortController();
        flags = {
          abort: abort ? controller : undefined,
          failCandidate: !abort,
          failRollback: !abort,
        };
        let error;
        try {
          await author.replace(doc, { signal: controller.signal, authoredInputs: ['value'] });
        } catch (e) {
          error = { message: e.message, causes: e.errors?.map((x) => x.message) };
        }
        flags = {};
        await scene.ready();
        return {
          error,
          snapshot: scene.snapshot(),
          document: author.document,
          visible: document.querySelector('.ve-stage span').textContent,
          same: scene === document.querySelector('main').scene,
        };
      };
      return {
        abort: await attempt('static', true),
        staticFailure: await attempt('static', false),
        timedFailure: await attempt('timed', false),
      };
    });
    for (const [name, r] of Object.entries(result)) {
      assert(r.error, name);
      assert.equal(r.snapshot.value, 6, name);
      assert.equal(r.visible, '6', name);
      assert.equal(r.document.models[0].inputs.value, 3, name);
      assert.equal(r.document.chapters.length, 1, name);
      assert(r.same, name);
      if (name !== 'abort') {
        assert(r.error.causes.includes('candidate paint failed'));
        assert(r.error.causes.includes('rollback paint failed'));
      }
    }
  } finally {
    await browser.close();
  }
});
