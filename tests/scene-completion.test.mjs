import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assetURLs } from '../tools/asset-urls.mjs';

async function fixture(contents, work) {
  const bundled = await build({
    stdin: { contents, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.setContent('<main class="ve-scene" style="position:relative;width:600px"></main>');
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    await work(page);
  } finally {
    await browser.close();
  }
}

test('3D hit testing, labels, keyboard and provenance share stable semantic objects', async () => {
  await fixture(
    `
    import {SceneShell} from './src/scene.ts';
    import {Viewport3D, ThreeKit as T, MathMorph3D} from './src/viewport/index.ts';
    import {MathMorph} from './src/morph/math.ts';
    const root=document.querySelector('main'), shell=SceneShell.mount(root,{title:'Objects'});
    shell.stage.style.cssText='width:600px;height:400px;position:relative';
    const view=Viewport3D.mount(shell.stage); shell.attachView(view);
    const group=new T.Group(), cube=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial({color:'blue'}));
    group.add(cube); view.setObject(group); view.shot({target:cube,direction:[0,0,1],padding:70});
    view.describe(cube,'amount',{label:'Количество',value:()=>7,unit:'см³',source:{file:'subject.ts'},inputs:()=>['source'],provenance:()=>({operation:'add',inputs:[3,4]})});
    const label=view.label('7 см³',cube,{offset:[0,-80]});
    root.scene.extend({view});
    window.lab={root,shell,view,group,cube,label,T,MathMorph,MathMorph3D};
  `,
    async (page) => {
      await page.waitForFunction(
        () => document.querySelector('button[data-object="amount"]')?.hidden === false,
      );
      const area = await page.locator('canvas').first().boundingBox();
      await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), ['amount']);
      const object = await page.evaluate(
        () => lab.root.scene.inspect({ presentation: false }).objects[0],
      );
      assert.equal(object.id, 'amount');
      assert.equal(object.value, 7);
      assert.deepEqual(object.source, { file: 'subject.ts' });
      assert.deepEqual(object.provenance, { operation: 'add', inputs: [3, 4] });
      await page.evaluate(() => lab.root.scene.select([]));
      await page.locator('button[data-object="amount"]').focus();
      await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), ['amount']);
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('button[data-object="amount"]')).outlineStyle ===
          'solid',
      );
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), []);
      const reorder = await page.evaluate(() => {
        const before = lab.root.scene.objects();
        lab.group.add(new lab.T.Object3D());
        lab.group.remove(lab.cube);
        lab.group.add(lab.cube);
        lab.view.invalidate();
        return {
          before: before.map((o) => o.id),
          after: lab.root.scene.objects().map((o) => o.id),
          review: lab.view.renderer.domElement
            .__visualReview()
            .objects.filter((o) => o.subjectId === 'amount'),
        };
      });
      assert.deepEqual(reorder.before, ['amount']);
      assert.deepEqual(reorder.after, ['amount']);
      assert.equal(reorder.review[0].id, 'amount');
      const morph = await page.evaluate(() => {
        const morph = lab.MathMorph3D.mount(lab.view, lab.MathMorph.calculate('add', 3, 4), {
          id: 'sum',
        });
        lab.view.setObject(morph.object);
        morph.render(1);
        lab.morph = morph;
        return lab.root.scene.objects();
      });
      const sum = morph.find((o) => o.id === 'sum');
      assert.equal(sum.value, 7);
      assert.equal(sum.provenance.result, 7);
      const result = morph.find((o) => o.id !== 'sum' && o.value === 7);
      assert(result?.provenance.origins.length, 'resolved cells retain their original inputs');
      assert(result.inputs.length, 'resolved cells point to the registered input subjects');
      assert(morph.every((o) => o.id === 'sum' || o.id.startsWith('sum:')));
      assert(
        !morph.some((o) => o.id === 'amount'),
        'removing geometry removes its semantic lifetime',
      );
    },
  );
});

test('revised chapters, typed extensions, late host state and playback approval use live owners', async () => {
  await fixture(
    `
    import {SceneShell} from './src/scene.ts';
    import {widgetState} from './src/host/widget-state.ts';
    const root=document.querySelector('main');
    const chapters=[{id:'first',title:'Начало',start:0,end:3,text:''},{id:'middle',title:'Середина',start:3,end:7,text:''},{id:'last',title:'Итог',start:7,end:10,text:''}];
    window.mount=(revised=false)=>{
      const shell=SceneShell.mount(root,{title:'Restore',parameters:[{key:'x',label:'X',value:1,min:0,max:revised?2:10}]});
      const script=revised?{duration:25,cues:{last:{start:20,end:25}},segments:[{...chapters[0],end:20},{...chapters[2],start:20,end:25}]}:{duration:10,cues:{moment:{start:4,end:6}},segments:chapters};
      const story=shell.attachStory({script,stateAt:()=>({x:1}),render:()=>{}});
      window.lab={root,shell,story};
    }; mount();
    window.widgetState=widgetState;
  `,
    async (page) => {
      const restored = await page.evaluate(async () => {
        await lab.root.scene.control([
          { type: 'seek', time: 5 },
          { type: 'mode', value: 'explore' },
          { type: 'parameters', values: { x: 7 } },
        ]);
        const checkpoint = lab.root.scene.capture();
        checkpoint.selected = ['removed'];
        lab.shell.dispose();
        mount(true);
        await lab.root.scene.restore(checkpoint);
        return {
          saved: checkpoint,
          state: lab.root.scene.inspect({ presentation: false }),
          status: lab.shell.status.textContent,
        };
      });
      assert.equal(restored.saved.chapter, 'middle');
      assert.equal(
        restored.state.time,
        0,
        'equally close surviving chapters prefer the preceding chapter',
      );
      assert.deepEqual(
        restored.state.restoreNotices.map((n) => n.code),
        ['cue-missing', 'parameters-changed', 'objects-missing'],
      );
      assert.match(restored.status, /Начало/);
      const extension = await page.evaluate(() => {
        class Owner {
          #value = 3;
          get observed() {
            return this.#value;
          }
          add() {
            return ++this.#value;
          }
        }
        const owner = new Owner(),
          handle = lab.root.scene.extend(owner);
        handle.add();
        const first = handle.observed;
        let denied = false;
        try {
          handle.extend({ dispose() {} });
        } catch {
          denied = true;
        }
        owner.add();
        return { first, current: handle.observed, denied };
      });
      assert.deepEqual(extension, { first: 4, current: 5, denied: true });
      const storage = await page.evaluate(() => {
        const receipts = [],
          restored = [];
        let subscriber;
        const bridge = widgetState('project', (value) => restored.push(value));
        lab.root.scene.connectHost({
          widgetState: {
            read: (id) => ({ privateContent: { id, amount: 2 } }),
            save: (id, state) => {
              receipts.push({ id, state });
              subscriber?.(state);
            },
            subscribe: (id, listener) => {
              subscriber = listener;
              return () => (subscriber = undefined);
            },
          },
          beforePlay: ({ signal }) =>
            new Promise((resolve) => {
              window.approve = resolve;
              window.approvalSignal = signal;
              window.approvals = (window.approvals ?? 0) + 1;
            }),
        });
        bridge.save({ privateContent: 5 });
        window.bridge = bridge;
        return { receipts, restored };
      });
      assert.equal(storage.receipts[0].id, 'project');
      assert.deepEqual(storage.restored, [{ privateContent: { id: 'project', amount: 2 } }]);
      await page.evaluate(() => lab.root.scene.control([{ type: 'mode', value: 'story' }]));
      await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
      await page.waitForFunction(() => window.approvals === 1);
      const waiting = await page.evaluate(() => ({
        time: lab.story.currentTime,
        pending: lab.story.player.state.playing,
      }));
      await page.waitForTimeout(60);
      assert.equal(
        await page.evaluate(() => lab.story.currentTime),
        waiting.time,
        'approval cannot start media early',
      );
      await page.getByRole('button', { name: 'Пауза', exact: true }).click();
      assert(await page.evaluate(() => approvalSignal.aborted));
      await page.evaluate(() => approve());
      assert.equal(await page.evaluate(() => lab.story.player.state.playing), false);
      await page.evaluate(() => {
        window.controlledPlay = lab.root.scene.control([{ type: 'play' }]);
      });
      await page.waitForFunction(() => approvals === 2);
      await page.evaluate(() => approve());
      await page.evaluate(() => controlledPlay);
      assert.equal(await page.evaluate(() => lab.story.player.state.playing), true);
      await page.evaluate(() => {
        window.controlledUnmute = lab.root.scene.control([{ type: 'mute', value: false }]);
      });
      await page.waitForFunction(() => approvals === 3);
      await page.evaluate(() => {
        lab.story.pause();
        approve();
      });
      await page.evaluate(() => controlledUnmute);
      assert.equal(
        await page.evaluate(() => lab.story.player.state.muted),
        true,
        'a paused pending unmute cannot reacquire sound after its lease is cancelled',
      );
      await page.evaluate(() => {
        lab.story.pause();
        bridge.dispose();
        lab.shell.dispose();
      });
    },
  );
});

test('a removed selected subject returns to its chapter and retains compatible experimental subjects', async () => {
  await fixture(
    `
    import {SceneShell} from './src/scene.ts';
    import {describeObject} from './src/scene-objects.ts';
    const root=document.querySelector('main');
    const shell=SceneShell.mount(root,{title:'Restore selection',parameters:[{key:'x',label:'X',value:1,min:0,max:10}]});
    function subject(id) {
      const element=document.createElement('button'); element.dataset.object=id; element.textContent=id;
      describeObject(element,{label:id}); shell.stage.append(element); return element;
    }
    subject('kept'); const removed=subject('removed'); let dynamic;
    const story=shell.attachStory({script:{duration:20,cues:{moment:{start:12,end:14}},segments:[
      {id:'first',title:'Начало',start:0,end:10,text:''},
      {id:'second',title:'Условие',start:10,end:20,text:''},
    ]},stateAt:()=>({x:1}),render:state=>{
      if(state.x===7) dynamic ??= subject('dynamic');
      else {dynamic?.remove(); dynamic=undefined;}
    }});
    window.lab={root,shell,removed};
  `,
    async (page) => {
      const restored = await page.evaluate(async () => {
        await lab.root.scene.control([
          { type: 'seek', time: 13 },
          { type: 'mode', value: 'explore' },
          { type: 'parameters', values: { x: 7 } },
        ]);
        await lab.root.scene.control([{ type: 'select', ids: ['removed', 'kept', 'dynamic'] }]);
        const checkpoint = lab.root.scene.capture();
        lab.removed.remove();
        await lab.root.scene.control([{ type: 'seek', time: 0 }]);
        await lab.root.scene.restore(checkpoint);
        return {
          state: lab.root.scene.inspect({ presentation: false }),
          status: lab.shell.status.textContent,
        };
      });
      assert.equal(restored.state.time, 10);
      assert.equal(restored.state.mode, 'explore');
      assert.equal(restored.state.parameters.find((p) => p.key === 'x').value, 7);
      assert.deepEqual(restored.state.selected, ['kept', 'dynamic']);
      assert.deepEqual(
        restored.state.restoreNotices.map((n) => n.code),
        ['objects-missing'],
      );
      assert.deepEqual(restored.state.restoreNotices[0].ids, ['removed']);
      assert.equal(restored.state.restoreNotices[0].chapter, 'second');
      assert.match(restored.status, /Условие/);
    },
  );
});

test('silent simulation and step owners cancel host approval before changing model time', async () => {
  await fixture(
    `
    import {SimulationPlayer} from './src/story/simulation.ts';
    import {StepPlayer} from './src/story/steps.ts';
    import {connectSceneHost} from './src/host/adapter.ts';
    let approve, permit, advances=0;
    const disconnect=connectSceneHost({beforePlay:({signal})=>new Promise(resolve=>{approve=resolve;permit=signal;})});
    window.trial=async()=>{
      const result=[];
      for(const kind of ['simulation','steps']){
        const element=document.createElement('section'); element.innerHTML='<div data-player></div>'; document.body.append(element);
        const player=kind==='simulation'?SimulationPlayer.mount(element,{read:()=>({value:0,done:false,stamp:'0'}),prepare(){advances++},advance(){advances++;return true;},step(){},render(){},commit(){}}):StepPlayer.mount(element,{count:3,render(){},interval:50});
        const before=advances, pending=player.play(); player.pause(); approve(); await pending;
        result.push({kind,aborted:permit.aborted,playing:player.playing,advanced:advances!==before});
        player.dispose(); element.remove();
      }
      disconnect(); return result;
    };
  `,
    async (page) => {
      assert.deepEqual(await page.evaluate(() => trial()), [
        { kind: 'simulation', aborted: true, playing: false, advanced: false },
        { kind: 'steps', aborted: true, playing: false, advanced: false },
      ]);
    },
  );
});

test('a pinned 0.9 handle gains a capability boundary without replacing its runtime', async () => {
  await fixture(
    `
    import {adaptScene} from './plugin/ui/scene-compat.mjs';
    let time=0, playing=false;
    const source={duration:10,get currentTime(){return time;},seek(next){time=next;},async play(){playing=true;},pause(){playing=false;},snapshot:()=>({time}),review:()=>({duration:10,cues:[{id:'sum',start:2,end:4,kind:'action',action:'Сложить',referenced:true}],segments:[]}),dispose(){playing=false;}};
    window.old={source,handle:adaptScene(source),playing:()=>playing};
  `,
    async (page) => {
      const state = await page.evaluate(() => old.handle.inspect({ presentation: false }));
      assert.deepEqual(state.capabilities, ['seek', 'play', 'pause', 'cue']);
      assert.equal(state.playing, undefined);
      assert.equal(state.compatibility.hostPlaybackPolicy, false);
      const moved = await page.evaluate(async () => {
        await old.handle.control([{ type: 'cue', id: 'sum', progress: 0.5 }]);
        const saved = old.handle.capture();
        old.source.seek(9);
        await old.handle.restore(saved);
        await old.handle.control([{ type: 'play' }]);
        return { time: old.source.currentTime, playing: old.playing(), saved };
      });
      assert.equal(moved.time, 3);
      assert.equal(moved.playing, true);
      assert.equal(moved.saved.cue, 'sum');
      await assert.rejects(
        page.evaluate(() => old.handle.control([{ type: 'parameters', values: { x: 4 } }])),
        /unavailable/,
      );
      await page.evaluate(() => old.handle.dispose());
      await assert.rejects(
        page.evaluate(() => old.handle.capture()),
        /disposed/,
      );
    },
  );
});
