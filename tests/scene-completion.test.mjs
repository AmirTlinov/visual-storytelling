import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assetURLs } from '../tools/asset-urls.mjs';

async function fixture(contents, work) {
  const bundled = await build({
    stdin: { contents: `import './dist/style.css';\n${contents}`, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    outdir: '.',
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.setContent('<main class="ve-scene" style="position:relative;width:600px"></main>');
    for (const output of bundled.outputFiles.filter((file) => file.path.endsWith('.css')))
      await page.addStyleTag({ content: output.text });
    await page.addScriptTag({
      content: bundled.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    await work(page);
  } finally {
    await browser.close();
  }
}

test('failed preparation preserves the completed frame; failed rendering invalidates capture', async () => {
  await fixture(
    `
    import {SceneShell} from './src/scene.ts';
    const root=document.querySelector('main');
    const shell=SceneShell.mount(root,{title:'Failures',parameters:[{key:'x',label:'X',value:1,min:0,max:10}]});
    let reject;
    const view={position:'manual',reset(){this.position='authored'},capture(){return {position:this.position}},dispose(){}};
    shell.attachView(view);
    const story=shell.attachStory({
      script:{duration:10,cues:{}},stateAt:frame=>({x:frame.time+1}),
      prepare(values){if(values.x===7)return new Promise((_,no)=>reject=no)},
      render(values){root.dataset.drawn=values.x; if(values.x===9)throw new Error('Drawing interrupted')},
    });
    root.scene.extend({snapshot:()=>({x:Number(root.dataset.drawn)})});
    window.lab={root,shell,story,view,reject:()=>reject(new Error('Resources unavailable'))};
  `,
    async (page) => {
      await page.evaluate(() => {
        window.change = lab.root.scene
          .control([{ type: 'seek', time: 6 }])
          .catch((error) => error.message);
      });
      const failedPreparation = await page.evaluate(async () => {
        lab.reject();
        await change;
        return {
          rendering: lab.root.scene.inspect({ presentation: false }).rendering,
          snapshot: lab.root.scene.snapshot(),
          capture: lab.root.scene.capture(),
          drawn: lab.root.dataset.drawn,
        };
      });
      assert.equal(failedPreparation.rendering.phase, 'failed');
      assert.equal(failedPreparation.rendering.error.stage, 'prepare');
      assert.equal(failedPreparation.rendering.requested.values.x, 7);
      assert.equal(failedPreparation.rendering.presented.values.x, 1);
      assert.deepEqual(failedPreparation.snapshot, { x: 1 });
      assert.equal(failedPreparation.capture.values.x, 1);
      assert.equal(failedPreparation.drawn, '1');
      assert.equal(
        failedPreparation.capture.view.position,
        'manual',
        'preparation failure preserves the previous camera',
      );
      const failedRender = await page.evaluate(async () => {
        await lab.root.scene.control([{ type: 'parameters', values: { x: 9 } }]).catch(() => {});
        let captureError;
        try {
          lab.root.scene.capture();
        } catch (error) {
          captureError = error.code;
        }
        return {
          rendering: lab.root.scene.inspect({ presentation: false }).rendering,
          snapshot: lab.root.scene.snapshot(),
          captureError,
          requested: lab.root.scene.capture({ basis: 'requested' }),
        };
      });
      assert.equal(failedRender.rendering.phase, 'failed');
      assert.equal(failedRender.rendering.error.stage, 'render');
      assert.equal(failedRender.rendering.presented, undefined);
      assert.equal(failedRender.snapshot, undefined);
      assert.equal(failedRender.captureError, 'scene_not_presented');
      assert.equal(failedRender.requested.values.x, 9);
      const recovered = await page.evaluate(async () => {
        await lab.root.scene.control([{ type: 'parameters', values: { x: 4 } }]);
        return {
          rendering: lab.root.scene.inspect({ presentation: false }).rendering,
          snapshot: lab.root.scene.snapshot(),
          capture: lab.root.scene.capture(),
        };
      });
      assert.equal(recovered.rendering.phase, 'ready');
      assert.deepEqual(recovered.rendering.requested, recovered.rendering.presented);
      assert.deepEqual(recovered.snapshot, { x: 4 });
      assert.equal(recovered.capture.values.x, 4);
      await page.evaluate(() => lab.root.scene.control([{ type: 'seek', time: 3 }]));
      assert.equal(
        await page.evaluate(() => lab.view.position),
        'authored',
        'a completed seek resets to the new authored shot',
      );
    },
  );
});

test('async input keeps one undo step and agent view commands match manual exploration', async () => {
  await fixture(
    `
    import {SceneShell} from './src/scene.ts';
    import {Viewport3D, ThreeKit as T} from './src/viewport/index.ts';
    const root=document.querySelector('main');
    const shell=SceneShell.mount(root,{title:'Preparation',parameters:[{key:'x',label:'X',value:1,min:0,max:10}]});
    shell.stage.style.cssText='width:600px;height:400px;position:relative';
    const view=Viewport3D.mount(shell.stage); shell.attachView(view);
    const cube=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial({color:'blue'}));
    const group=new T.Group(), other=cube.clone(); other.position.x=12; group.add(cube,other);
    view.setObject(group); view.describe(cube,'cube',{label:'Cube'});
    let finish; const prepared=new Set();
    const story=shell.attachStory({
      script:{duration:4,cues:{all:{start:0,end:4}}},stateAt:()=>({x:1}),
      prepare(values){if([7,9].includes(values.x)&&!prepared.has(values.x))return new Promise(resolve=>finish=()=>{prepared.add(values.x);resolve()})},
      render(values,frame,mode){root.dataset.drawn=values.x;view.shot({target:group,direction:mode==='story'?[0,0,1]:[2,1,4],padding:70})},
    });
    window.lab={root,shell,story,view,finish:()=>finish()};
  `,
    async (page) => {
      const authored = await page.evaluate(() => lab.view.capture());
      await page.evaluate(() => {
        window.change = lab.root.scene.control([{ type: 'parameters', values: { x: 7 } }]);
      });
      const pending = await page.evaluate(() => ({
        parameter: lab.root.scene.inspect({ presentation: false }).parameters[0].value,
        model: lab.story.requested.values.x,
        drawn: lab.root.dataset.drawn,
        rendering: lab.root.scene.inspect({ presentation: false }).rendering,
        snapshot: lab.root.scene.snapshot(),
        visible: lab.root.scene.capture().values.x,
        requested: lab.root.scene.capture({ basis: 'requested' }),
      }));
      assert.equal(pending.parameter, 7);
      assert.equal(pending.model, 7);
      assert.equal(pending.drawn, '1');
      assert.deepEqual(pending.snapshot, { x: 1 });
      assert.equal(pending.visible, 1);
      assert.equal(pending.requested.values.x, 7);
      assert.equal(pending.requested.view, undefined);
      assert.equal(pending.requested.selected, undefined);
      assert.equal(pending.rendering.phase, 'preparing');
      assert.equal(pending.rendering.requested.values.x, 7);
      assert.equal(pending.rendering.presented.values.x, 1);
      await page.evaluate(async () => {
        lab.finish();
        await change;
      });
      assert.equal(await page.evaluate(() => lab.root.dataset.drawn), '7');
      assert.deepEqual(await page.evaluate(() => lab.root.scene.experimentHistory), {
        undo: true,
        redo: false,
      });
      await page.evaluate(() => lab.root.scene.control([{ type: 'undoExperiment' }]));
      assert.equal(await page.evaluate(() => lab.root.dataset.drawn), '1');
      assert.deepEqual(await page.evaluate(() => lab.root.scene.experimentHistory), {
        undo: false,
        redo: true,
      });

      const cancelled = await page.evaluate(async () => {
        const controller = new AbortController();
        const blocked = lab.root.scene
          .control(
            [
              { type: 'parameters', values: { x: 9 } },
              { type: 'parameters', values: { x: 5 } },
            ],
            { signal: controller.signal },
          )
          .then(
            () => 'completed',
            (error) => ({
              message: error.message,
              code: error.code,
              completedCommands: error.completedCommands,
              action: error.action,
            }),
          );
        controller.abort(new Error('User continued the experiment'));
        return Promise.race([
          blocked,
          new Promise((resolve) => setTimeout(() => resolve('still waiting for resources'), 100)),
        ]);
      });
      assert.match(cancelled.message, /User continued the experiment/);
      assert.equal(cancelled.code, 'scene_control_cancelled');
      assert.equal(cancelled.completedCommands, 0);
      assert.equal(cancelled.action, 'inspect');
      await page.evaluate(async () => {
        await lab.root.scene.control([{ type: 'parameters', values: { x: 8 } }]);
        lab.finish();
        await lab.root.scene.ready();
      });
      assert.equal(await page.evaluate(() => lab.root.dataset.drawn), '8');
      await page.evaluate(() => lab.root.scene.control([{ type: 'mode', value: 'story' }]));
      await page.waitForFunction(
        (position) =>
          lab.view.capture().position.every((value, i) => Math.abs(value - position[i]) < 1e-10),
        authored.position,
      );
      await page.locator('canvas').first().focus();
      await page.keyboard.press('ArrowLeft');
      const orbited = await page.evaluate(() => lab.view.capture());
      assert.equal(orbited.following, false);
      assert.notDeepEqual(orbited.position, authored.position);
      await page.evaluate(() => lab.root.scene.control([{ type: 'focus', ids: ['cube'] }]));
      const focused = await page.evaluate(() => lab.view.capture());
      assert.notDeepEqual(focused.position, orbited.position, 'focus works after a manual orbit');
      assert.equal(focused.following, false);
      await page.evaluate(() => lab.story.update());
      assert.deepEqual(
        await page.evaluate(() => lab.view.capture().position),
        focused.position,
        'the next story frame preserves an explicit exploratory focus',
      );
      const invalid = await page.evaluate(async () => {
        try {
          await lab.root.scene.control([
            { type: 'focus', ids: ['absent'] },
            { type: 'seek', time: 2 },
          ]);
        } catch (error) {
          return {
            message: error.message,
            time: lab.story.currentTime,
            camera: lab.view.capture(),
          };
        }
      });
      assert.match(invalid.message, /Unavailable 3D subject/);
      assert.equal(invalid.time, 0);
      assert.deepEqual(invalid.camera, focused, 'known-owner validation has no effects');
      const returning = await page.evaluate(async () => {
        const before = lab.view.capture();
        await lab.root.scene.control([{ type: 'mode', value: 'story' }]);
        const immediate = lab.view.capture(),
          transition = lab.root.scene.inspect({ presentation: false }).viewTransition,
          samples = [],
          start = performance.now();
        await new Promise((resolve) => {
          const sample = () => {
            samples.push({
              time: performance.now() - start,
              position: lab.view.capture().position,
            });
            if (performance.now() - start < 280) requestAnimationFrame(sample);
            else resolve();
          };
          requestAnimationFrame(sample);
        });
        return { before, immediate, samples, transition };
      });
      assert.equal(returning.transition, 'running');
      returning.immediate.position.forEach((value, i) =>
        assert(
          Math.abs(value - returning.before.position[i]) < 1e-10,
          'return starts at the displayed pose',
        ),
      );
      assert(
        returning.samples.some(
          (sample) =>
            sample.position.some((value, i) => Math.abs(value - authored.position[i]) > 1e-5) &&
            sample.position.some(
              (value, i) => Math.abs(value - returning.before.position[i]) > 1e-5,
            ),
        ),
        'return draws intermediate camera poses',
      );
      assert.deepEqual(await page.evaluate(() => lab.view.capture()), authored);
      assert.equal(
        await page.evaluate(() => lab.root.scene.inspect({ presentation: false }).viewTransition),
        'idle',
      );
      await page.locator('canvas').first().focus();
      await page.keyboard.press('ArrowLeft');
      await page.getByRole('button', { name: 'Рассказ', exact: true }).click();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.locator('canvas').first().focus();
      await page.keyboard.press('ArrowRight');
      const interrupted = await page.evaluate(() => lab.view.capture());
      assert.equal(
        await page.evaluate(() => lab.root.scene.inspect({ presentation: false }).viewTransition),
        'idle',
      );
      await page.waitForTimeout(280);
      assert.deepEqual(
        await page.evaluate(() => lab.view.capture()),
        interrupted,
        'a new orbit interrupts the return',
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => lab.root.scene.control([{ type: 'mode', value: 'story' }]));
      assert.deepEqual(await page.evaluate(() => lab.view.capture()), authored);
      await page.evaluate(() => lab.root.scene.control([{ type: 'mode', value: 'explore' }]));
      const exploratory = await page.evaluate(() => lab.view.capture());
      assert.notDeepEqual(exploratory.position, authored.position);
      await page.locator('canvas').first().focus();
      await page.keyboard.press('ArrowLeft');
      await page.evaluate(() => lab.root.scene.control([{ type: 'mode', value: 'explore' }]));
      assert.deepEqual(
        await page.evaluate(() => lab.view.capture()),
        exploratory,
        'Explore restores its own authored viewpoint',
      );
      assert.equal(await page.evaluate(() => lab.story.currentTime), 0);
    },
  );
});

test('3D hit testing, labels, keyboard and provenance share stable semantic objects', async () => {
  await fixture(
    `
    import {SceneShell} from './src/scene.ts';
    import {Viewport3D, ThreeKit as T, MathMorph3D} from './src/viewport/index.ts';
    import {MathMorph} from './src/morph/math.ts';
    import {describeObject} from './src/scene-objects.ts';
    const root=document.querySelector('main'), shell=SceneShell.mount(root,{title:'Objects'});
    shell.stage.style.cssText='width:600px;height:400px;position:relative';
    const view=Viewport3D.mount(shell.stage); shell.attachView(view);
    const group=new T.Group(), cube=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial({color:'blue'}));
    group.add(cube); view.setObject(group); view.shot({target:cube,direction:[0,0,1],padding:70});
    view.describe(cube,'amount',{label:'Количество',value:()=>7,unit:'см³',source:{file:'subject.ts'},inputs:()=>['source'],provenance:()=>({operation:'add',inputs:[3,4]})});
    const label=view.label('7 см³',cube,{offset:[0,-80]});
    root.scene.extend({view});
    window.lab={root,shell,view,group,cube,label,T,MathMorph,MathMorph3D,describeObject};
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
      await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), []);
      await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), ['amount']);
      await page.mouse.click(area.x + 5, area.y + 5);
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), []);
      await page.locator('button[data-object="amount"]').focus();
      await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), ['amount']);
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('button[data-object="amount"]')).outlineStyle ===
          'dashed',
      );
      assert.equal(
        await page.locator('[data-selection-highlight][data-object="amount"]').count(),
        1,
      );
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), []);
      await page.evaluate(() => {
        const parent = document.createElement('div');
        parent.dataset.object = 'container';
        parent.style.display = 'contents';
        lab.view.renderer.domElement.before(parent);
        parent.append(lab.view.renderer.domElement);
        lab.forgetContainer = lab.describeObject(parent, { label: 'Container' });
        lab.activations = 0;
        lab.root.addEventListener('scene-selection', () => lab.activations++);
      });
      const nestedArea = await page.locator('canvas').first().boundingBox();
      await page.mouse.click(
        nestedArea.x + nestedArea.width / 2,
        nestedArea.y + nestedArea.height / 2,
      );
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), ['amount']);
      assert.equal(
        await page.evaluate(() => lab.activations),
        1,
        'one geometry hit activates once',
      );
      await page.evaluate(() => {
        const canvas = lab.view.renderer.domElement,
          parent = canvas.parentElement;
        lab.forgetContainer();
        parent.replaceWith(canvas);
      });
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
      const batched = await page.evaluate(async () => {
        const operation = lab.MathMorph.dot(Array(32).fill(1), Array(32).fill(1));
        const stages = lab.MathMorph.plan(operation).stages;
        const at = (stages / 2 + 1) / stages;
        const morph = lab.MathMorph3D.mount(lab.view, operation, { id: 'dot' });
        lab.view.setObject(morph.object);
        morph.render(at);
        await new Promise(requestAnimationFrame);
        const collecting = lab.root.scene.objects();
        morph.render(at + (1 - 1e-6) / stages);
        await new Promise(requestAnimationFrame);
        const partial = lab.root.scene.objects();
        morph.render(1);
        await new Promise(requestAnimationFrame);
        const complete = lab.root.scene.objects();
        morph.render(at);
        await new Promise(requestAnimationFrame);
        return { collecting, partial, complete, reverse: lab.root.scene.objects() };
      });
      for (const state of [batched.collecting, batched.reverse]) {
        const carried = state.find((o) => o.id === 'dot:result');
        assert.equal(carried.value, 16, 'a carried result describes the currently visible value');
        assert.equal(carried.provenance.origins.length, 32);
      }
      assert.equal(batched.partial.find((o) => o.id === 'dot:result').value, 20);
      const complete = batched.complete.find((o) => o.id === 'dot:result');
      assert.equal(complete.value, 32);
      assert.equal(
        complete.inputs.length,
        64,
        'direct seeking retains input IDs from stages that have never been displayed',
      );
      assert.equal(batched.complete.find((o) => o.id === 'dot').inputs.length, 64);
      assert.deepEqual(
        batched.complete
          .filter((o) => o.visible)
          .map((o) => o.id)
          .sort(),
        ['dot', 'dot:result'],
      );
    },
  );
});

test('SVG math parts share inspect, find, pointer, keyboard and provenance through replacement', async () => {
  await fixture(
    `
    import {SceneShell} from './src/scene.ts';
    import {MathMorph2D} from './src/morph/svg.ts';
    import {MathMorph} from './src/morph/math.ts';
    import './dist/style.css';
    const root=document.querySelector('main'), shell=SceneShell.mount(root,{title:'SVG math'});
    const morph=MathMorph2D.mount(shell.stage,MathMorph.dot([1,2,3],[4,5,6]),{id:'dot'});
    window.lab={root,shell,morph,MathMorph};
  `,
    async (page) => {
      const initial = await page.evaluate(
        () => lab.root.scene.inspect({ presentation: false }).objects,
      );
      const input = initial.find((part) => part.id !== 'dot' && part.visible);
      assert(input, 'the SVG exposes rendered quantity regions');
      const target = page.locator(`[data-object="${input.id}"]`);
      await target.click();
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), [input.id]);
      assert.equal(await target.getAttribute('aria-pressed'), 'true');
      assert.equal(await target.evaluate((node) => node.matches(':focus-visible')), false);
      await page.keyboard.press('Tab');
      await target.focus();
      assert.equal(await target.evaluate((node) => node.matches(':focus-visible')), true);
      assert.equal(await target.evaluate((node) => getComputedStyle(node).outlineStyle), 'dashed');
      assert.equal(await page.locator('[data-selection-highlight]').count(), 1);
      assert.equal(await target.getAttribute('data-selection-highlight'), '');
      await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), []);

      const complete = await page.evaluate(() => {
        lab.morph.render(1);
        return lab.root.scene.inspect({ presentation: false }).objects;
      });
      const result = complete.find((part) => part.id === 'dot:result');
      assert.equal(result.value, 32);
      assert.equal(
        result.inputs.length,
        6,
        'direct seeking preserves original inputs from unseen stages',
      );
      assert.equal(result.provenance.origins.length, 6);
      assert.equal(complete.find((part) => part.id === 'dot').value, 32);
      assert.equal(complete.find((part) => part.id === input.id).visible, false);
      assert.equal(
        await target.isVisible(),
        false,
        'inactive inputs retain provenance without hit or keyboard targets',
      );
      const found = await page.evaluate(() => lab.root.scene.find('Величина 32'));
      assert(found.some((part) => part.id === 'dot:result'));
      await page.evaluate(() => lab.root.scene.control([{ type: 'select', ids: ['dot:result'] }]));
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), ['dot:result']);

      const replaced = await page.evaluate(() => {
        lab.morph.setOperation(lab.MathMorph.calculate('add', 3, 4));
        lab.morph.render(1);
        return lab.root.scene.inspect({ presentation: false }).objects;
      });
      assert.equal(replaced.find((part) => part.id === 'dot').value, 7);
      assert(
        !replaced.some((part) => part.id === input.id),
        'replaced operation registrations are released',
      );
      await page.evaluate(() => lab.morph.dispose());
      assert.deepEqual(await page.evaluate(() => lab.root.scene.objects()), []);
      assert.deepEqual(await page.evaluate(() => lab.root.scene.selected), []);
    },
  );
});

test('a remounted composition restores the active chapter camera and semantic selection', async () => {
  await fixture(
    `
    import {SceneStory} from './src/story/composition.ts';
    import {Viewport3D, ThreeKit as T} from './src/viewport/index.ts';
    import './dist/style.css';
    const root=document.querySelector('main'); let active;
    const chapters=['opening','space','end'].map(id=>({id,title:id,text:id,seconds:2,
      async mount(parent){
        if(id!=='space')return {render(){parent.textContent=id},dispose(){parent.replaceChildren()}};
        await new Promise(resolve=>setTimeout(resolve,30));
        const view=Viewport3D.mount(parent);
        const cube=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial({color:'blue'}));
        view.setObject(cube);view.describe(cube,'cube',{label:'Cube'});active=view;
        return {view,render(){view.shot({target:cube,direction:[0,0,1],padding:50})},dispose:view.dispose};
      }
    }));
    window.remount=async()=>{
      root.scene?.dispose();
      const lesson=await SceneStory.mount(root,{title:'Chapters',chapters,frame:{width:600,height:400}});
      window.lab={...lesson,root,view:()=>active};
    };
    window.galleryReady=remount();
  `,
    async (page) => {
      await page.evaluate(() => galleryReady);
      const future = await page.evaluate(async () => {
        try {
          await lab.scene.control([
            { type: 'seek', time: 3 },
            { type: 'select', ids: ['absent'] },
          ]);
        } catch (error) {
          return {
            message: error.message,
            code: error.code,
            commandIndex: error.commandIndex,
            completedCommands: error.completedCommands,
            action: error.action,
            time: lab.scene.inspect({ presentation: false }).time,
          };
        }
      });
      assert.match(future.message, /Select needs known object IDs/);
      assert.deepEqual(
        { ...future, message: undefined },
        {
          message: undefined,
          code: 'scene_control_failed',
          commandIndex: 1,
          completedCommands: 1,
          action: 'inspect',
          time: 3,
        },
      );
      await page.evaluate(async () => {
        await remount();
        await lab.scene.control([
          { type: 'seek', time: 3 },
          { type: 'select', ids: ['cube'] },
          { type: 'focus', ids: ['cube'] },
        ]);
      });
      assert.deepEqual(await page.evaluate(() => lab.scene.selected), ['cube']);
      await page.locator('[data-chapter="space"] canvas').focus();
      await page.keyboard.press('ArrowLeft');
      const result = await page.evaluate(async () => {
        await lab.scene.control([{ type: 'select', ids: ['cube'] }]);
        const camera = lab.view().capture(),
          saved = lab.scene.capture();
        await remount();
        const initial = lab.scene.inspect({ presentation: false });
        await lab.scene.restore(saved);
        return {
          camera,
          saved,
          initial: initial.capabilities,
          restored: lab.view().capture(),
          state: lab.scene.inspect({ presentation: false }),
        };
      });
      assert.equal(result.camera.following, false);
      assert(result.saved.view, 'the checkpoint includes the logical chapter camera');
      assert.equal(result.initial.includes('select'), false);
      assert.equal(result.state.time, 3);
      assert.deepEqual(result.state.selected, ['cube']);
      assert.deepEqual(result.restored, result.camera);
      assert.deepEqual(result.state.restoreNotices, []);
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
      const cold = await page.evaluate(async () => {
        const scene = lab.root.scene;
        scene.select(['dynamic']);
        const saved = scene.capture();
        scene.select([]);
        lab.root.querySelector('[data-object="kept"]').remove();
        await scene.control([{ type: 'seek', time: 0 }]);
        const before = scene.inspect({ presentation: false }).capabilities;
        await scene.restore(saved);
        return { before, selected: scene.selected, notices: scene.restoreNotices };
      });
      assert.equal(cold.before.includes('select'), false);
      assert.deepEqual(cold.selected, ['dynamic']);
      assert.deepEqual(cold.notices, []);
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
