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
 window.flags={};window.IllustratedStory=IllustratedStory;
 const model={validateInputs:({value})=>({value}),state:({value})=>({value}),operations:{double:s=>({value:s.value*2})},validateViews(){},focusTargets:()=>[]};
 const subject={title:'Counter',parameters:m=>[{key:'value',label:'Value',type:'number',value:m.inputs.value,min:0,max:10}],create(viewport){
  const mark=document.createElement('span');viewport.stage.append(mark);
  return {validate(){},prepare(m,v,state){if(flags.viewer && state.value===5)return new Promise(resolve=>flags.releaseViewer=resolve)},render(m,v,state){mark.textContent=state.value;if(flags.abort && state.value===4) flags.abort.abort(Error('cancelled after render'));},snapshot:s=>s,
   ready(){if(flags.metadata && mark.textContent==='5')return new Promise(resolve=>flags.releaseMetadata=resolve);if(flags.delay && ['4','8'].includes(mark.textContent))return new Promise(resolve=>flags.release=resolve);if(flags.failCandidate && ['4','8'].includes(mark.textContent))throw Error('candidate paint failed');if(flags.failRollback && mark.textContent==='6')throw Error('rollback paint failed');},dispose(){mark.remove()}};
 }};
 window.ownershipCase=async(voiced)=>{
  const root=document.createElement('main');root.className='ve-scene';document.body.append(root);
  let audio,url;
  if(voiced){
    const rate=8000,frames=rate*12,bytes=new Uint8Array(44+frames*2),view=new DataView(bytes.buffer);
    const word=(offset,text)=>[...text].forEach((c,i)=>bytes[offset+i]=c.charCodeAt(0));
    word(0,'RIFF');view.setUint32(4,bytes.length-8,true);word(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,frames*2,true);
    url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));audio=new Audio(url);await new Promise((resolve,reject)=>{audio.onloadeddata=resolve;audio.onerror=reject});
  }
  const source={version:2,models:[{id:'counter',module:'counter',inputs:{value:3}}],views:[],chapters:[{id:'double',title:'Double',beats:[{id:'action',seconds:10,operation:{model:'counter',name:'double'}}]}]};
  const lesson=await IllustratedStory.mount(root,{document:source,modules:{counter:model},subjects:{counter:subject},audio});
  const errors=[];root.addEventListener('scene-cleanup-error',event=>errors.push(event.detail.message));
  await lesson.scene.play();const playingBefore=lesson.story.player.state.playing;
  const failRetire=()=>{const old=lesson.story,dispose=old.dispose;old.dispose=()=>{dispose();throw Error('retired owner failed')};return old};
  const old=failRetire(),next=structuredClone(lesson.scene.authoring.document);next.models[0].inputs.value=4;
  flags={delay:true};
  const replacing=lesson.scene.authoring.replace(next,{authoredInputs:['value']});
  while(!flags.release)await new Promise(resolve=>setTimeout(resolve,1));
  await new Promise(resolve=>setTimeout(resolve,80));
  const held={playing:old.player.state.playing,visible:root.querySelector('.ve-stage:not([data-presentation-pending]) span').textContent,snapshot:lesson.scene.snapshot().value,authored:lesson.scene.authoring.document.models[0].inputs.value};
  flags.release();flags={};await replacing;const resumed=lesson.story.player.state.playing;lesson.scene.pause();
  const immediate={visible:root.querySelector('.ve-stage span').textContent,value:lesson.scene.snapshot().value};
  await lesson.scene.play();await lesson.scene.ready();
  // Let the accepted handoff's own media promise settle; do not issue a second Play.
  await new Promise(resolve=>setTimeout(resolve,50));
  const timed={playing:lesson.story.player.state.playing,mediaPaused:audio?.paused,hasAudio:lesson.story.player.state.hasAudio,value:lesson.scene.snapshot().value,document:lesson.scene.authoring.document.models[0].inputs.value,players:root.querySelectorAll('.vs-player').length};
  let oldDisposed=false;try{old.input({value:9})}catch{oldDisposed=true}
  lesson.scene.pause();failRetire();const quiet=structuredClone(lesson.scene.authoring.document);quiet.chapters=[];
  await lesson.scene.authoring.replace(quiet);lesson.shell.input({value:5});
  const stationary={value:lesson.scene.snapshot().value,chapters:lesson.scene.authoring.document.chapters.length,seek:typeof lesson.scene.seek,playerHidden:root.querySelector('[data-player]').hidden};
  await lesson.scene.authoring.replace(next);await lesson.scene.ready();
  const retry=typeof lesson.scene.seek;lesson.scene.dispose();root.remove();if(url)URL.revokeObjectURL(url);
  return {playingBefore,held,immediate,resumed,timed,oldDisposed,stationary,retry,errors};
 };
 window.reopenFailure=async()=>{
  const root=document.createElement('main');root.className='ve-scene';document.body.append(root);
  const source={version:2,models:[{id:'counter',module:'counter',inputs:{value:3}}],views:[],chapters:[{id:'double',title:'Double',beats:[{id:'action',seconds:2,operation:{model:'counter',name:'double'}}]}]};
  const mount=()=>IllustratedStory.mount(root,{document:source,modules:{counter:model},subjects:{counter:subject}});
  const lesson=await mount(),next=structuredClone(source);next.models[0].inputs.value=4;
  flags={failCandidate:true,failRollback:true};await lesson.scene.authoring.replace(next,{authoredInputs:['value']}).catch(()=>{});flags={};
  const blocked=root.inert;lesson.scene.dispose();const afterDispose=root.inert;
  const reopened=await mount();await reopened.scene.control([{type:'parameters',values:{value:5}}]);
  const result={blocked,afterDispose,value:reopened.scene.snapshot().value,frozen:root.querySelectorAll('[data-presentation-frozen]').length};
  flags={delay:true};const pending=reopened.scene.authoring.replace(next,{authoredInputs:['value']}).catch(error=>error.message);while(!flags.release)await new Promise(resolve=>setTimeout(resolve,1));const release=flags.release;reopened.scene.dispose();flags={};const latest=await mount();release();await pending;await latest.scene.control([{type:'parameters',values:{value:5}}]);
  result.pendingReopen={inert:root.inert,value:latest.scene.snapshot().value,frozen:root.querySelectorAll('[data-presentation-frozen]').length};latest.scene.dispose();root.remove();return result;
 };
 window.concurrentReplacement=async()=>{
  const root=document.createElement('main');root.className='ve-scene';document.body.append(root);
  const source={version:2,models:[{id:'counter',module:'counter',inputs:{value:3}}],views:[],chapters:[{id:'double',title:'Double',beats:[{id:'action',seconds:2,operation:{model:'counter',name:'double'}}]}]};
  const lesson=await IllustratedStory.mount(root,{document:source,modules:{counter:model},subjects:{counter:subject}});
  const first=structuredClone(source),second=structuredClone(source);first.models[0].inputs.value=4;second.models[0].inputs.value=5;
  const abort=new AbortController();flags={delay:true};
  const pending=lesson.scene.authoring.replace(first,{signal:abort.signal,authoredInputs:['value']}).catch(error=>error.message);
  while(!flags.release)await new Promise(resolve=>setTimeout(resolve,1));
  const release=flags.release;abort.abort(Error('cancelled replacement'));
  let rejected;try{await lesson.scene.authoring.replace(second,{authoredInputs:['value']})}catch(error){rejected=error.code}
  const held={value:lesson.scene.snapshot().value,document:lesson.scene.authoring.document.models[0].inputs.value};
  flags={};release();const cancelled=await pending;
  await lesson.scene.authoring.replace(second,{authoredInputs:['value']});
  const accepted={inert:root.inert,value:lesson.scene.snapshot().value,document:lesson.scene.authoring.document.models[0].inputs.value,frozen:root.querySelectorAll('[data-presentation-frozen]').length};
  lesson.scene.dispose();root.remove();return {rejected,held,cancelled,accepted};
 };
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
  const browser = await chromium.launch(
    chromiumLaunchOptions({ args: ['--autoplay-policy=no-user-gesture-required'] }),
  );
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
    await assert.rejects(
      page.evaluate(() => lab.scene.control([{ type: 'parameters', values: { value: 5 } }])),
      /suspended/,
    );
    await assert.rejects(
      page.evaluate(() => lab.scene.seek(1)),
      /suspended/,
    );
    await assert.rejects(
      page.evaluate(() => lab.scene.play()),
      /suspended/,
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        snapshot: lab.scene.snapshot().value,
        presented: lab.story.presented.values.value,
        inert: document.querySelector('main').inert,
      })),
      { snapshot: 6, presented: 6, inert: true },
    );
    await page.evaluate(async () => {
      const doc = lab.scene.authoring.document;
      doc.title = 'Recovered';
      await lab.scene.authoring.replace(doc);
    });
    assert.equal(await page.evaluate(() => document.querySelector('main').inert), false);
    const pendingViewer = await page.evaluate(async () => {
      flags = { viewer: true };
      const input = lab.scene.control([{ type: 'parameters', values: { value: 5 } }]);
      while (!flags.releaseViewer) await new Promise((resolve) => setTimeout(resolve, 1));
      const source = lab.scene.authoring.document;
      source.title = 'Updated';
      const edited = lab.scene.authoring.replace(source);
      flags.releaseViewer();
      flags = {};
      await Promise.all([input, edited]);
      return {
        value: lab.scene.snapshot().value,
        authored: lab.scene.authoring.document.models[0].inputs.value,
        title: lab.scene.authoring.document.title,
      };
    });
    assert.deepEqual(pendingViewer, { value: 5, authored: 3, title: 'Updated' });
    const draft = await page.evaluate(async () => {
      const root = document.querySelector('main'),
        input = root.querySelector('.ve-parameters input:not([type=range])');
      input.focus();
      input.value = '';
      input.setAttribute('aria-invalid', 'true');
      flags = { metadata: true };
      const doc = lab.scene.authoring.document;
      doc.title = 'Preserve draft';
      const editing = lab.scene.authoring.replace(doc);
      while (!flags.releaseMetadata) await new Promise((resolve) => setTimeout(resolve, 1));
      await new Promise((resolve) => setTimeout(resolve, 40));
      flags.releaseMetadata();
      flags = {};
      await editing;
      return {
        same: document.activeElement === input,
        draft: input.value,
        model: lab.scene.snapshot().value,
      };
    });
    assert.deepEqual(draft, { same: true, draft: '', model: 5 });
    for (const voiced of [false, true]) {
      const ownership = await page.evaluate((voiced) => ownershipCase(voiced), voiced);
      assert(ownership.playingBefore);
      assert.deepEqual(ownership.held, { playing: false, visible: '6', snapshot: 6, authored: 3 });
      assert.deepEqual(ownership.immediate, { visible: '8', value: 8 });
      assert(ownership.resumed);
      assert(ownership.timed.playing);
      assert.equal(ownership.timed.hasAudio, voiced);
      if (voiced) assert.equal(ownership.timed.mediaPaused, false);
      assert.equal(ownership.timed.document, 4);
      assert.equal(ownership.timed.value, 8);
      assert.equal(ownership.timed.players, 1);
      assert(ownership.oldDisposed);
      assert.deepEqual(ownership.stationary, {
        value: 5,
        chapters: 0,
        seek: 'undefined',
        playerHidden: true,
      });
      assert.equal(ownership.retry, 'function');
      assert.deepEqual(ownership.errors, ['retired owner failed', 'retired owner failed']);
    }
    assert.deepEqual(await page.evaluate(() => reopenFailure()), {
      blocked: true,
      afterDispose: false,
      value: 5,
      frozen: 0,
      pendingReopen: { inert: false, value: 5, frozen: 0 },
    });
    assert.deepEqual(await page.evaluate(() => concurrentReplacement()), {
      rejected: 'scene_authoring_busy',
      held: { value: 6, document: 3 },
      cancelled: 'cancelled replacement',
      accepted: { inert: false, value: 10, document: 5, frozen: 0 },
    });
    const firstStory = await page.evaluate(async () => {
      const root = document.createElement('main');
      root.className = 've-scene';
      document.body.append(root);
      const lesson = await IllustratedStory.mount(root, {
        document: { recipe: 'division', inputs: { count: 17, divisor: 4 }, chapters: [] },
      });
      await lesson.scene.control([{ type: 'parameters', values: { count: 21 } }]);
      const source = structuredClone(lesson.scene.authoring.document);
      source.chapters = [
        {
          id: 'first',
          title: 'Проверим группы',
          beats: [{ id: 'group', seconds: 2, operation: { model: 'division', name: 'group' } }],
        },
      ];
      await lesson.scene.authoring.replace(source);
      const result = {
        count: lesson.scene.snapshot().count,
        mode: lesson.scene.inspect().mode,
        authored: lesson.scene.authoring.document.models[0].inputs.count,
      };
      lesson.scene.dispose();
      root.remove();
      return result;
    });
    assert.deepEqual(firstStory, { count: 21, mode: 'explore', authored: 17 });
  } finally {
    await browser.close();
  }
});
