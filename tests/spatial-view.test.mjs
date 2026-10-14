import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

async function fixture(contents, work) {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `import './dist/style.css';\n${contents}` },
    bundle: true,
    write: false,
    outdir: '.',
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    page.setDefaultTimeout(5000);
    await page.setContent(
      '<main class="ve-scene" style="position:relative;width:600px;height:400px;padding:0;box-sizing:border-box"></main>',
    );
    await page.addStyleTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
    });
    await work(page);
  } finally {
    await browser.close();
  }
}

test('a tiny physical subject fits and its manual checkpoint retains depth precision across remount and resize', async () => {
  await fixture(
    `
    import {Viewport3D, ThreeKit as T} from './dist/viewport/index.js';
    const stage=document.querySelector('main'), group=new T.Group();
    const building=new T.Mesh(new T.BoxGeometry(.002,.002,.002),new T.MeshBasicMaterial({color:'blue'}));
    building.position.set(300,0,200);group.add(building);
    const view=Viewport3D.mount(stage);view.setObject(group,{fitView:false});
    view.describe(building,'building',{label:'Building'});view.shot({target:building});
    window.lab={stage,view,building,T,Viewport3D};
  `,
    async (page) => {
      const saved = await page.evaluate(async () => {
        await lab.view.whenRendered();
        lab.view.focus(['building']);
        await lab.view.whenRendered();
        const box = new lab.T.Box3().setFromObject(lab.building);
        const xs = [];
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z])
              xs.push(new lab.T.Vector3(x, y, z).project(lab.view.camera).x);
        return {
          checkpoint: lab.view.capture(),
          pixels: ((Math.max(...xs) - Math.min(...xs)) * lab.stage.clientWidth) / 2,
        };
      });
      assert(
        saved.pixels > 100,
        `world-scale floor makes the actual building a speck: ${JSON.stringify(saved)}`,
      );
      const restored = await page.evaluate(async (checkpoint) => {
        lab.view.dispose();
        lab.view = lab.Viewport3D.mount(lab.stage);
        lab.building = new lab.T.Mesh(
          new lab.T.BoxGeometry(0.002, 0.002, 0.002),
          new lab.T.MeshBasicMaterial({ color: 'blue' }),
        );
        lab.building.position.set(300, 0, 200);
        lab.view.setObject(lab.building, { fitView: false });
        lab.view.describe(lab.building, 'building', { label: 'Building' });
        lab.view.shot({
          target: new lab.T.Box3(
            new lab.T.Vector3(-500, -500, -500),
            new lab.T.Vector3(500, 500, 500),
          ),
        });
        const accepted = lab.view.restore(checkpoint);
        await lab.view.whenRendered();
        const before = lab.view.capture();
        const rejected = lab.view.restore({ ...checkpoint, near: NaN });
        return { accepted, rejected, before, after: lab.view.capture() };
      }, saved.checkpoint);
      assert(restored.accepted);
      assert(!restored.rejected);
      for (const key of ['position', 'target'])
        saved.checkpoint[key].forEach((value, index) =>
          assert(Math.abs(restored.before[key][index] - value) < 1e-10),
        );
      assert.deepEqual(
        { ...restored.before, position: [], target: [] },
        { ...saved.checkpoint, position: [], target: [] },
      );
      assert.deepEqual(restored.after, restored.before);
      await page.evaluate(() => (lab.stage.style.width = '160px'));
      await page.waitForFunction(() => Math.abs(lab.view.camera.aspect - 0.4) < 1e-9);
      const narrow = await page.evaluate(() => lab.view.capture());
      const distance = (p) => Math.hypot(...p.position.map((v, i) => v - p.target[i]));
      assert(
        distance(narrow) > distance(saved.checkpoint) * 2,
        'manual orbit is lost on authored-only view resize',
      );
      assert.equal(narrow.following, false);
      await page.evaluate(() => lab.view.dispose());
    },
  );
});

test('GPU readiness settles failure, falsey cancellation, recovery and resource disposal', async () => {
  await fixture(
    `
    import {Viewport3D, ThreeKit as T} from './dist/viewport/index.js';
    const view=Viewport3D.mount(document.querySelector('main'));
    const mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());view.setObject(mesh);
    let fail=false;view.ink(mesh.material,p=>{if(fail)throw new Error('Paint failed');return p.blue});
    window.lab={view,setFail(value){fail=value}};
  `,
    async (page) => {
      const result = await page.evaluate(async () => {
        const first = await lab.view.whenRendered();
        lab.view.invalidate();
        const abort = new AbortController();
        const cancelled = lab.view.whenRendered(abort.signal).then(
          () => 'resolved',
          (e) => e,
        );
        abort.abort(0);
        const reason = await cancelled;
        lab.setFail(true);
        lab.view.invalidate();
        const failure = await lab.view.whenRendered().then(
          () => 'resolved',
          (e) => e.message,
        );
        const repeated = await lab.view.whenRendered().then(
          () => 'resolved',
          (e) => e.message,
        );
        lab.setFail(false);
        lab.view.invalidate();
        const recovered = await lab.view.whenRendered();
        lab.view.invalidate();
        const releasing = lab.view.whenRendered().then(
          () => 'resolved',
          (e) => e.message,
        );
        lab.view.dispose();
        const disposed = await releasing;
        return { first, reason, failure, repeated, recovered, disposed };
      });
      assert(result.first > 0);
      assert.equal(result.reason, 0);
      assert.equal(result.failure, 'Paint failed');
      assert.equal(result.repeated, 'Paint failed');
      assert(result.recovered > result.first);
      assert.match(result.disposed, /disposed/);
    },
  );
});

test('a lost GPU context rejects readiness before reporting a new frame', async () => {
  await fixture(
    `
    import {Viewport3D,ThreeKit as T} from './dist/viewport/index.js';
    const view=Viewport3D.mount(document.querySelector('main'));
    view.setObject(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()));
    view.renderer.forceContextLoss();
    window.result=view.whenRendered().then(()=>({accepted:true}),e=>({accepted:false,message:e.message}));
    window.view=view;
  `,
    async (page) => {
      const result = await page.evaluate(() => window.result);
      assert.equal(result.accepted, false);
      assert.match(result.message, /context.*lost/);
      await page.evaluate(() => view.dispose());
    },
  );
});

test('an old successful frame cannot acknowledge a currently lost GPU context', async () => {
  await fixture(
    `
    import {Viewport3D,ThreeKit as T} from './dist/viewport/index.js';
    const view=Viewport3D.mount(document.querySelector('main'));
    view.setObject(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()));
    window.result=(async()=>{
      const first=await view.whenRendered();view.renderer.forceContextLoss();
      return view.whenRendered().then(()=>({accepted:true,first}),e=>({accepted:false,first,message:e.message}));
    })();
    window.view=view;
  `,
    async (page) => {
      const result = await page.evaluate(() => window.result);
      assert(result.first > 0);
      assert.equal(result.accepted, false);
      assert.match(result.message, /context.*lost/);
      await page.evaluate(() => view.dispose());
    },
  );
});

test('a failed first GPU paint leaves the accepted chapter visible and its checkpoint intact', async () => {
  await fixture(
    `
    import {SceneStory} from './dist/story/index.js';
    import {Viewport3D, ThreeKit as T} from './dist/viewport/index.js';
    const chapters=[{id:'a',title:'A',text:'A',seconds:1,mount(parent){
      const label=document.createElement('span');parent.append(label);
      return {render(){label.textContent='Accepted frame'},snapshot(){return {id:'a'}},dispose(){label.remove()}};
    }},{id:'b',title:'B',text:'B',seconds:1,mount(parent){
      const view=Viewport3D.mount(parent),mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());
      view.setObject(mesh);let fail=false;view.ink(mesh.material,p=>{if(fail)throw new Error('First paint failed');return p.blue});
      return {render(){fail=true;view.invalidate()},ready:view.whenRendered,view,dispose:view.dispose};
    }}];
    window.galleryReady=SceneStory.mount(document.querySelector('main'),{title:'Atomic first frame',chapters}).then(lab=>window.lab=lab);
  `,
    async (page) => {
      await page.evaluate(() => galleryReady);
      const before = await page.evaluate(() => lab.scene.capture());
      const error = await page.evaluate(() =>
        lab.scene.control([{ type: 'seek', time: 1.2 }]).then(
          () => 'resolved',
          (e) => e.message,
        ),
      );
      assert.match(error, /First paint failed/);
      assert.equal(await page.locator('[data-chapter="a"]').isVisible(), true);
      assert.equal(await page.locator('[data-chapter="b"]').isVisible(), false);
      assert.equal(
        (await page.evaluate(() => lab.scene.capture())).values.chapter,
        before.values.chapter,
      );
      await page.evaluate(() => lab.scene.dispose());
    },
  );
});
