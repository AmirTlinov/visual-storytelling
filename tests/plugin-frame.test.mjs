import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('a native host without RAF keeps prepared observations, reversible suspension and manual priority', async () => {
  const adapter = await build({
    entryPoints: ['plugin/ui/scene-frame.mjs'],
    bundle: true,
    write: false,
    format: 'iife',
  });
  const scene = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import {SceneShell} from './src/scene.ts';
      const root=document.querySelector('.ve-scene');
      const shell=SceneShell.mount(root,{title:'Async scene',parameters:[{key:'x',label:'X',value:1,min:0,max:10}]});
      const drawn=document.createElement('output'); drawn.id='drawn'; shell.stage.append(drawn);
      shell.attachStory({script:{duration:4,cues:{all:{start:0,end:4}},segments:[{id:'all',text:'Long lesson',start:0,end:4,words:Array.from({length:2000},()=>({text:'word',start:0,end:4}))}]},stateAt:()=>({x:1,payload:'x'.repeat(300000)}),
        prepare(values){if(values.x===8)throw new Error('Candidate cannot restore this condition');if(values.x===7)return new Promise(resolve=>setTimeout(resolve,180))},
        render(values){drawn.textContent=values.x},
      });
      window.requestAnimationFrame=()=>123;
    `,
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(
      '<iframe title="Scene" sandbox="allow-scripts" style="width:700px;height:700px"></iframe>',
    );
    await page.evaluate((html) => {
      window.messages = [];
      addEventListener('message', (event) => {
        if (event.data?.channel === 'visual-story-scene-v1') messages.push(event.data);
      });
      document.querySelector('iframe').srcdoc = html;
    }, `<!doctype html><html><head></head><body><main class="ve-scene"></main><script>${scene.outputFiles[0].text}</script><script>window.__visualStorySession={generation:1,stateRevision:0}</script><script>${adapter.outputFiles[0].text}</script></body></html>`);
    await page.waitForFunction(() => messages.some((m) => m.type === 'ready'));
    const frame = page.frameLocator('iframe');
    const command = async (request) => {
      const id = crypto.randomUUID();
      await page.evaluate(
        ({ id, request }) =>
          document.querySelector('iframe').contentWindow.postMessage(
            {
              channel: 'visual-story-scene-v1',
              generation: 1,
              type: 'command',
              command: { ...request, id, expiresAt: Date.now() + 2000 },
            },
            '*',
          ),
        { id, request },
      );
      await page.waitForFunction((id) => messages.some((m) => m.id === id && m.type === 'ack'), id);
      return page.evaluate((id) => messages.find((m) => m.id === id && m.type === 'ack'), id);
    };
    await frame.getByRole('button', { name: 'Исследовать', exact: true }).click();
    await frame.getByRole('slider', { name: 'X', exact: true }).fill('7');
    const inspected = await command({ op: 'inspect' });
    assert.equal(inspected.error, undefined);
    assert.equal(
      inspected.report.renderStatus,
      'prepared',
      'a deferred repaint is never claimed as displayed',
    );
    assert.equal(inspected.report.state.parameters[0].value, 7);
    assert.ok(
      JSON.stringify(inspected.report).length < 6000,
      'background observations omit model payloads and the full transcript',
    );
    const model = await command({ op: 'inspect', detail: 'model' });
    assert.equal(model.report.state.snapshot.payload.length, 300000);
    assert.equal(model.result, undefined, 'the requested model is transmitted once');
    const timeline = await command({ op: 'inspect', detail: 'timeline' });
    assert.equal(timeline.report.state.timeline.segments[0].words.length, 2000);
    assert.equal(
      await frame.locator('#drawn').innerText(),
      '7',
      'inspect awaits async preparation',
    );
    const suspended = await command({ op: 'suspend' });
    assert.equal(suspended.error, undefined);
    assert.equal(await frame.locator('body').evaluate((body) => body.inert), true);
    assert.equal((await command({ op: 'resume' })).error, undefined);
    assert.equal(await frame.locator('body').evaluate((body) => body.inert), false);
    const slider = await frame.getByRole('slider', { name: 'X', exact: true }).boundingBox();
    await page.mouse.move(slider.x + slider.width / 2, slider.y + slider.height / 2);
    await page.mouse.down();
    const duringGesture = await command({ op: 'inspect' });
    const rejected = await command({
      op: 'control',
      stateRevision: duringGesture.report.stateRevision,
      commands: [{ type: 'parameters', values: { x: 9 } }],
    });
    assert.match(rejected.error, /gesture/);
    await page.mouse.up();
    const afterGesture = await command({ op: 'inspect' });
    const accepted = await command({
      op: 'control',
      stateRevision: afterGesture.report.stateRevision,
      commands: [{ type: 'parameters', values: { x: 9 } }],
    });
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.report.checkpoint.values.x, 9);

    const mountPreview = async () => {
      await page.evaluate((html) => {
        window.messages = [];
        document.querySelector('iframe').srcdoc = html;
      }, `<!doctype html><html><body><main class="ve-scene"></main><script>${scene.outputFiles[0].text}</script><script>window.__visualStorySession={generation:-1,stateRevision:0,preview:true}</script><script>${adapter.outputFiles[0].text}</script></body></html>`);
      await page.waitForFunction(() =>
        messages.some((m) => m.type === 'ready' && m.generation === -1),
      );
    };
    await mountPreview();
    const preview = async (id, x) => {
      await page.evaluate(
        ({ id, x }) =>
          document.querySelector('iframe').contentWindow.postMessage(
            {
              channel: 'visual-story-scene-v1',
              generation: -1,
              type: 'restore-preview',
              replacementId: id,
              expiresAt: Date.now() + 2000,
              stateRevision: 11,
              checkpoint: { time: 0, progress: 0, mode: 'explore', values: { x } },
            },
            '*',
          ),
        { id, x },
      );
      await page.waitForFunction((id) => messages.some((m) => m.replacementId === id), id);
      return page.evaluate((id) => messages.find((m) => m.replacementId === id), id);
    };
    const rejectedPreview = await preview('failed-candidate', 8);
    assert.equal(rejectedPreview.type, 'preview-error');
    assert.match(rejectedPreview.message, /cannot restore/);
    await mountPreview();
    const restoredPreview = await preview('prepared-candidate', 7);
    assert.equal(restoredPreview.type, 'preview-restored', JSON.stringify(restoredPreview));
    assert.equal(await frame.locator('#drawn').innerText(), '7');
    await page.evaluate(() =>
      document.querySelector('iframe').contentWindow.postMessage(
        {
          channel: 'visual-story-scene-v1',
          generation: -1,
          type: 'activate',
          replacementId: 'prepared-candidate',
          nextGeneration: 2,
          stateRevision: 11,
        },
        '*',
      ),
    );
    await page.waitForFunction(() =>
      messages.some((m) => m.type === 'ready' && m.generation === 2),
    );
    const promoted = await page.evaluate(() =>
      messages.find((m) => m.type === 'ready' && m.generation === 2),
    );
    assert.equal(promoted.report.checkpoint.values.x, 7);
    assert.equal(promoted.report.stateRevision, 11);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
