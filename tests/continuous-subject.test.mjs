import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const evidence = 'artifacts/continuous-subject';
async function fixture(contents, width = 960) {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents },
    bundle: true,
    write: false,
    outdir: '.',
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width, height: 720 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<main class="ve-scene"></main>');
  await page.addStyleTag({ content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text });
  await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text });
  await page.evaluate(() => window.ready);
  return { browser, page, errors };
}
const script = `
 import {SceneStory} from './dist/story/index.js'; import {describeObject} from './dist/scene-objects.js';import './dist/style.css';
 const events=[];let unblock;
 const chapters=['first','second','broken','delayed','last'].map(id=>({id,title:id,text:'',seconds:1,async mount(parent,signal){
  events.push('mount '+id);
  const node=document.createElement('div');node.dataset.object='order:417';parent.append(node);let state;
  const release=describeObject(node,{label:'Заказ 417',value:()=>state,interactive:false});
  if(id==='delayed')await new Promise((resolve,reject)=>{unblock=resolve;signal.addEventListener('abort',()=>{release();events.push('abort '+id);reject(signal.reason)},{once:true})});
  return {render(frame){state={chapter:id,time:frame.time};node.textContent=id+':'+frame.time;if(id==='broken')throw Error('first render refused')},snapshot:()=>state,dispose(){release();node.remove();events.push('dispose '+id)}};
 }}));
 window.events=events;window.unblock=()=>unblock?.();window.ready=SceneStory.mount(document.querySelector('main'),{title:'one object',chapters}).then(lab=>window.lab=lab);
`;
test('same ID follows accepted chapter on reverse seeks and excludes pending geometry; failed first render retains accepted pixels and checkpoint', async () => {
  const { browser, page, errors } = await fixture(script);
  try {
    const observed = () =>
      page.evaluate(() => ({
        objects: lab.scene.inspect().objects,
        rendering: lab.scene.inspect().rendering,
        checkpoint: lab.scene.capture(),
        shown: [
          ...document.querySelectorAll('[data-chapter]:not([hidden]):not([data-chapter-pending])'),
        ].map((n) => n.dataset.chapter),
      }));
    await page.evaluate(async () => {
      lab.scene.seek(1.5);
      await lab.scene.ready();
      lab.scene.select(['order:417']);
    });
    assert.equal((await observed()).objects[0].value.chapter, 'second');
    await page.evaluate(async () => {
      lab.scene.seek(0.5);
      await lab.scene.ready();
    });
    const before = await observed();
    assert.equal(before.objects[0].value.chapter, 'first');
    assert.deepEqual(before.checkpoint.selected, ['order:417']);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: evidence + '/accepted-before-error.png' });
    await page.evaluate(async () => {
      lab.scene.seek(2.5);
      await lab.scene.ready().catch(() => {});
    });
    const failed = await observed();
    assert.equal(failed.rendering.phase, 'failed');
    assert.equal(failed.rendering.presented.values.chapter, 'first');
    assert.deepEqual(failed.shown, ['first']);
    assert.equal(failed.objects[0].value.chapter, 'first');
    assert.deepEqual(failed.checkpoint.values, before.checkpoint.values);
    await page.screenshot({ path: evidence + '/accepted-after-error.png' });
    await page.evaluate(() => lab.scene.seek(3.5));
    await page.waitForFunction(() => events.includes('mount delayed'));
    assert.equal((await observed()).objects[0].value.chapter, 'first');
    await page.evaluate(async () => {
      lab.scene.seek(4.5);
      await lab.scene.ready();
    });
    assert.ok(await page.evaluate(() => events.includes('abort delayed')));
    assert.equal((await observed()).objects[0].value.chapter, 'last');
    await writeFile(
      evidence + '/lifecycle.json',
      JSON.stringify(
        { before, failed, events: await page.evaluate(() => events), errors },
        null,
        2,
      ),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

const document = {
  version: 2,
  models: [
    {
      id: 'route',
      module: 'dependency-route',
      inputs: { orderId: '417', reserve: 'none', 'disabled-provider': true },
    },
  ],
  views: [
    { id: 'network', kind: 'dependency-network', model: 'route' },
    { id: 'status', kind: 'order-status', model: 'route' },
  ],
  chapters: [
    {
      id: 'stopped',
      title: 'Где остановился заказ?',
      views: ['network'],
      beats: [{ id: 'follow', operation: { model: 'route', name: 'trace' }, seconds: 1 }],
    },
    {
      id: 'reserved',
      title: 'Почему резерв тоже зависит от А?',
      beats: [
        { id: 'connect', operation: { model: 'route', name: 'reconnect-shared' }, seconds: 1 },
        { id: 'follow', operation: { model: 'route', name: 'trace' }, seconds: 1 },
      ],
    },
    {
      id: 'separate',
      title: 'Как обойти общий отказ?',
      beats: [
        { id: 'connect', operation: { model: 'route', name: 'reconnect-independent' }, seconds: 1 },
        { id: 'follow', operation: { model: 'route', name: 'trace' }, seconds: 1 },
      ],
    },
    {
      id: 'removed',
      title: 'Что осталось после удаления?',
      beats: [{ id: 'remove', operation: { model: 'route', name: 'remove-order' }, seconds: 1 }],
    },
  ],
};
test('chapter factories consume full document trace, preserve viewer inputs and identity after eviction/remount, and expose removal', async () => {
  const code = `
 import {IllustratedStory} from './dist/story/index.js';import {describeObject} from './dist/scene-objects.js';import './dist/style.css';
 const source=${JSON.stringify(document)},events=[];let input;
 const mount=()=>IllustratedStory.mount(document.querySelector('main'),{document:source,parameters:[{key:'reserve',label:'Резерв',type:'select',value:'none',options:[{value:'none',label:'Нет'},{value:'shared',label:'Общий'},{value:'independent',label:'Независимый'}]}],chapters:Object.fromEntries(source.chapters.map(ch=>[ch.id,authored=>({...authored,async mount(parent){
   events.push('mount '+ch.id);const node=document.createElement('div');node.dataset.object='route:order:417';parent.append(node);let state;
   const release=describeObject(node,{label:'Заказ 417',interactive:false,value:()=>state});return {render(frame){state=frame.subject;const model=state.models.route;node.hidden=model.present===false;node.textContent=model.trace.orderId+':'+model.trace.status+':'+model.reserve;},snapshot:()=>state,dispose(){events.push('dispose '+ch.id);release();node.remove()}};
 }})]))});window.events=events;window.mountAgain=mount;window.ready=mount().then(value=>window.lab=value);`;
  const { browser, page, errors } = await fixture(code);
  try {
    await page.evaluate(async () => {
      lab.scene.seek(0.9);
      await lab.scene.ready();
      lab.scene.select(['route:order:417']);
    });
    let state = await page.evaluate(() => lab.scene.snapshot().content);
    assert.equal(state.models.route.trace.blocked, 'provider');
    assert.deepEqual(
      state.views.map((v) => v.id),
      ['network'],
    );
    assert.ok(state.models.route.trace.events.every((e) => e.orderId === '417'));
    await page.evaluate(async () => {
      await lab.scene.control([{ type: 'parameters', values: { reserve: 'independent' } }]);
      await lab.scene.control([
        { type: 'parameters', values: { chapter: 'reserved', sceneTime: 1 } },
      ]);
    });
    state = await page.evaluate(() => lab.scene.snapshot().content);
    assert.equal(state.models.route.reserve, 'independent');
    assert.equal(state.models.route.trace.status, 'delivered');
    await page.evaluate(async () => {
      await lab.scene.control([{ type: 'mode', value: 'story' }]);
      lab.scene.seek(2.8);
      await lab.scene.ready();
    });
    state = await page.evaluate(() => lab.scene.snapshot().content);
    assert.equal(state.models.route.reserve, 'shared');
    assert.equal(state.models.route.trace.blocked, 'provider');
    await page.evaluate(async () => {
      lab.scene.seek(4.8);
      await lab.scene.ready();
      lab.scene.seek(0.9);
      await lab.scene.ready();
    });
    assert.ok(await page.evaluate(() => events.includes('dispose stopped')));
    assert.equal(
      (await page.evaluate(() => lab.scene.inspect())).objects[0].value.models.route.reserve,
      'none',
    );
    await page.evaluate(async () => {
      const cp = lab.scene.capture();
      lab.scene.dispose();
      window.lab = await mountAgain();
      await lab.scene.restore(cp);
    });
    assert.deepEqual((await page.evaluate(() => lab.scene.inspect())).selected, [
      'route:order:417',
    ]);
    await page.evaluate(async () => {
      lab.scene.seek(6);
      await lab.scene.ready();
    });
    const removed = await page.evaluate(() => lab.scene.snapshot().content);
    assert.equal(removed.models.route.present, false);
    assert.equal((await page.evaluate(() => lab.scene.inspect())).objects[0].visible, false);
    assert.deepEqual(errors, []);
    await writeFile(
      evidence + '/factory.json',
      JSON.stringify({ removed, events: await page.evaluate(() => events) }, null, 2),
    );
  } finally {
    await browser.close();
  }
});

test('ordinary unrelated SceneStory chapters retain their independent baselines', async () => {
  const { browser, page } = await fixture(`
 import {SceneStory} from './dist/story/index.js';import './dist/style.css';
 const chapters=['a','b'].map(id=>({id,title:id,text:'',seconds:1,valuesAt:()=>({closed:true}),mount(parent){return {render(frame){parent.textContent=String(frame.values.closed)},dispose(){parent.textContent=''}}}}));
 window.ready=SceneStory.mount(document.querySelector('main'),{title:'Independent chapters',parameters:[{key:'closed',label:'Closed',type:'toggle',value:true}],chapters}).then(lab=>window.lab=lab);
 `);
  try {
    await page.evaluate(async () => {
      await lab.scene.control([{ type: 'parameters', values: { closed: false } }]);
      await lab.scene.control([{ type: 'parameters', values: { chapter: 'b' } }]);
    });
    assert.equal(
      (await page.evaluate(() => lab.scene.inspect())).parameters.find((p) => p.key === 'closed')
        .value,
      true,
    );
  } finally {
    await browser.close();
  }
});

test('non-idempotent document operations run once for factory frames and preserve class presentation methods', async () => {
  const { browser, page } = await fixture(`
 import {IllustratedStory} from './dist/story/index.js';import {describeObject} from './dist/scene-objects.js';import './dist/style.css';
 const module={validateInputs(v){if(typeof v.n!=='number'||!Number.isFinite(v.n))throw Error('bad n');return{n:v.n}},state:v=>({...v}),experimentState:v=>({...v}),operations:{increment:(s,p)=>({n:s.n+p})},validateViews(){},focusTargets:()=>['counter:quantity']};
 const source={version:2,models:[{id:'counter',module:'counter',inputs:{n:10}}],views:[{id:'amount',kind:'quantity',model:'counter'}],chapters:[{id:'change',title:'One increment',beats:[{id:'one',seconds:1,operation:{model:'counter',name:'increment'}}]},{id:'end',title:'End',beats:[{id:'hold',seconds:1}]}]};let disposed=0,focused=0,captured=0;
 class Drawing {constructor(parent){this.node=document.createElement('div');this.node.dataset.object='counter:quantity';parent.append(this.node);this.release=describeObject(this.node,{label:'Quantity',value:()=>this.frame.subject.models.counter.n});}render(frame){this.frame=frame;this.node.textContent=String(frame.subject.models.counter.n)}snapshot(){return this.frame.subject}capture(){captured++;return document.createElement('canvas')}get view(){return{focus(){focused++},reset(){},capture(){return {focused}},restore(){return true}}}dispose(){disposed++;this.release();this.node.remove()}}
 class Chapter {constructor(authored){Object.assign(this,authored)}mount(parent){return new Drawing(parent)}}
 const mount=()=>IllustratedStory.mount(document.querySelector('main'),{document:source,modules:{counter:module},parameters:[{key:'n',label:'n',type:'stepper',value:10,min:0,max:100}],chapters:Object.fromEntries(source.chapters.map(ch=>[ch.id,authored=>new Chapter(authored)]))});
 window.stats=()=>({disposed,focused,captured});window.ready=mount().then(lab=>window.lab=lab);
 `);
  try {
    await page.evaluate(async () => {
      lab.scene.seek(0.5);
      await lab.scene.ready();
    });
    const value = await page.evaluate(() => ({
      frame: lab.scene.snapshot().frame,
      content: lab.scene.snapshot().content,
    }));
    assert.equal(value.frame.values.n, 10.5);
    assert.equal(value.content.models.counter.n, 10.5);
    await page.evaluate(() => lab.scene.control([{ type: 'focus', ids: ['counter:quantity'] }]));
    assert.equal((await page.evaluate(() => stats())).focused, 1);
    await page.evaluate(() => lab.scene.dispose());
    assert.equal((await page.evaluate(() => stats())).disposed, 1);
  } finally {
    await browser.close();
  }
});

test('failed snapshot transition is prepared off screen and preserves the prior chapter and checkpoint', async () => {
  const { browser, page, errors } = await fixture(`
 import {SceneStory} from './dist/story/index.js';import './dist/style.css';
 const chapters=['a','b'].map(id=>({id,title:id,text:'',seconds:1,mount(parent){let frame;const node=document.createElement('div');node.textContent=id;parent.append(node);return{render(value){frame=value},snapshot:()=>({id,time:frame.time}),dispose(){node.remove()}}}}));
 const transition={duration:.2,mount(parent){return{render(state){parent.textContent='effect:'+state.chapter;if(state.chapter===1)throw Error('transition rejected')},dispose(){parent.textContent=''}}}};
 window.ready=SceneStory.mount(document.querySelector('main'),{title:'Snapshot',chapters,transition}).then(lab=>window.lab=lab);
 `);
  try {
    await page.evaluate(async () => {
      lab.scene.seek(0.5);
      await lab.scene.ready();
    });
    const before = await page.evaluate(() => lab.scene.capture());
    await page.evaluate(async () => {
      lab.scene.seek(1.5);
      await lab.scene.ready().catch(() => {});
    });
    const after = await page.evaluate(() => ({
      capture: lab.scene.capture(),
      inspection: lab.scene.inspect(),
      visible: [
        ...document.querySelectorAll('[data-chapter]:not([hidden]):not([data-chapter-pending])'),
      ].map((n) => ({ id: n.dataset.chapter, text: n.textContent })),
    }));
    assert.equal(after.inspection.rendering.phase, 'failed');
    assert.equal(after.inspection.rendering.presented.values.chapter, 'a');
    assert.deepEqual(after.capture.values, before.values);
    assert.deepEqual(
      after.visible.map((n) => n.id),
      ['a'],
    );
    assert.ok(after.visible[0].text.includes('effect:0'));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('reused route geometry exposes the latest planned trace when an explicit reserve attempt changes its path', async () => {
  const { browser, page } = await fixture(`
 import {IllustratedStory} from './dist/story/index.js';import './dist/style.css';
 const document={version:2,models:[{id:'route',module:'dependency-route',inputs:{orderId:'417',reserve:'shared','disabled-provider':true}}],views:[{id:'network',kind:'dependency-network',model:'route'},{id:'status',kind:'order-status',model:'route'}],chapters:[{id:'main',title:'Main',beats:[{id:'follow',seconds:1,operation:{model:'route',name:'trace'}}]},{id:'reserve',title:'Reserve',beats:[{id:'follow',seconds:1,operation:{model:'route',name:'try-reserve'}}]}]};
 window.ready=IllustratedStory.mount(globalThis.document.querySelector('main'),{document}).then(lab=>window.lab=lab);
 `);
  try {
    await page.evaluate(async () => {
      lab.scene.seek(0.99);
      await lab.scene.ready();
      window.packet = globalThis.document.querySelector('[data-object="route:order:417"]');
    });
    assert.deepEqual(
      (await page.evaluate(() => lab.scene.inspect())).objects.find(
        (o) => o.id === 'route:order:417',
      ).provenance.route,
      ['shop', 'gateway', 'provider'],
    );
    await page.evaluate(async () => {
      lab.scene.seek(1.99);
      await lab.scene.ready();
    });
    const result = await page.evaluate(() => ({
      same: packet === globalThis.document.querySelector('[data-object="route:order:417"]'),
      object: lab.scene.inspect().objects.find((o) => o.id === 'route:order:417'),
      snapshot: lab.scene.snapshot(),
    }));
    assert.equal(result.same, true);
    assert.deepEqual(result.object.provenance.route, result.snapshot.route);
    assert.deepEqual(result.object.provenance.route, ['shop', 'backup', 'provider']);
    assert.deepEqual(result.object.provenance.plannedEvents, result.snapshot.events);
    assert.equal(result.object.value.outcome, result.snapshot.outcome);
  } finally {
    await browser.close();
  }
});

test('semantic camera focus follows a continuous ID in explore and survives checkpoint without sharing numeric cameras', async () => {
  const { browser, page } = await fixture(`
 import {IllustratedStory} from './dist/story/index.js';import {describeObject} from './dist/scene-objects.js';import './dist/style.css';
 const module={validateInputs:v=>({n:Number(v.n)}),state:v=>({...v}),experimentState:v=>({...v}),operations:{},validateViews(){},focusTargets:()=>['counter:quantity']};
 const source={version:2,models:[{id:'counter',module:'counter',inputs:{n:10}}],views:[{id:'amount',kind:'quantity',model:'counter'}],chapters:['a','b'].map(id=>({id,title:id,beats:[{id:'hold',seconds:1}]}))};
 const mount=()=>IllustratedStory.mount(document.querySelector('main'),{document:source,modules:{counter:module},parameters:[{key:'n',label:'n',type:'stepper',value:10,min:0,max:100}],chapters:Object.fromEntries(source.chapters.map(ch=>[ch.id,authored=>({...authored,mount(parent){const node=document.createElement('div');node.dataset.object='counter:quantity';parent.append(node);const release=describeObject(node,{label:'Quantity'});let focused=[],camera=ch.id==='a'?11:22;window.orbit=()=>{camera=88};return{render(frame){node.textContent=String(frame.subject.models.counter.n)},snapshot:()=>({focus:[...focused],camera}),view:{validateFocus(ids){if(ids.some(id=>id!=='counter:quantity'))throw Error('wrong object')},focus(ids){focused=[...ids];camera=ch.id==='a'?101:202},reset(){focused=[];camera=ch.id==='a'?11:22},capture(){return{focus:[...focused],camera}},restore(state){focused=[...state.focus];camera=state.camera;return true}},dispose(){release();node.remove()}};}})]))});window.mountAgain=mount;window.ready=mount().then(lab=>window.lab=lab);
 `);
  try {
    await page.evaluate(() =>
      lab.scene.control([
        { type: 'parameters', values: { n: 11 } },
        { type: 'focus', ids: ['counter:quantity'] },
      ]),
    );
    await page.evaluate(() =>
      lab.scene.control([{ type: 'parameters', values: { chapter: 'b' } }]),
    );
    const before = await page.evaluate(() => ({
      snapshot: lab.scene.snapshot(),
      cp: lab.scene.capture(),
    }));
    assert.deepEqual(before.snapshot.content.focus, ['counter:quantity']);
    assert.equal(before.snapshot.content.camera, 202);
    await page.evaluate(() => orbit());
    assert.equal(before.snapshot.frame.values.n, 11);
    await page.evaluate(async () => {
      const cp = lab.scene.capture();
      lab.scene.dispose();
      window.lab = await mountAgain();
      await lab.scene.restore(cp);
    });
    const after = await page.evaluate(() => lab.scene.snapshot());
    assert.deepEqual(after.content.focus, ['counter:quantity']);
    assert.equal(after.content.camera, 88, 'numeric checkpoint preserves manual orbit after focus');
    await page.evaluate(() => lab.scene.control([{ type: 'mode', value: 'story' }]));
    assert.equal((await page.evaluate(() => lab.scene.snapshot())).frame.values.n, 10);
    assert.deepEqual((await page.evaluate(() => lab.scene.snapshot())).content.focus, []);
    await page.evaluate(() =>
      lab.scene.control([
        { type: 'focus', ids: ['counter:quantity'] },
        { type: 'seek', time: 0.5 },
      ]),
    );
    assert.deepEqual((await page.evaluate(() => lab.scene.snapshot())).content.focus, [
      'counter:quantity',
    ]);
  } finally {
    await browser.close();
  }
});
