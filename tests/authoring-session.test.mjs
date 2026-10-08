import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { develop } from '../tools/dev.mjs';
import { requestSession } from '../tools/dev-session.mjs';
import { parse } from 'parse5';
import { build } from 'esbuild';

test('ordered scene commands can enter a chapter before focusing its objects', async () => {
  const bundle = await build({
    entryPoints: ['src/scene-access.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const { sceneAccess } = await import(
    'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
  );
  let values = { chapter: 'paper' },
    focused;
  const handle = {
    currentTime: 0,
    duration: 1,
    snapshot: () => values,
    review: () => ({ cues: [] }),
  };
  const owner = {
    playing: () => false,
    mode: () => 'explore',
    values: () => values,
    parameters: [
      {
        key: 'chapter',
        value: 'paper',
        label: 'Chapter',
        options: [
          { value: 'paper', label: 'Paper' },
          { value: 'cast', label: 'Cast' },
        ],
      },
    ],
    visible: () => true,
    assertLive() {},
    setMode() {},
    setValues(next) {
      values = next;
      if (next.chapter === 'cast')
        handle.focus = (ids) => {
          focused = ids;
        };
      else delete handle.focus;
    },
  };
  const access = sceneAccess(handle, owner);
  await access.control([
    { type: 'parameters', values: { chapter: 'cast' } },
    { type: 'focus', ids: ['board.content'] },
  ]);
  assert.deepEqual(focused, ['board.content']);
  await assert.rejects(
    access.control([
      { type: 'parameters', values: { chapter: 'paper' } },
      { type: 'focus', ids: ['board.content'] },
    ]),
    (error) => {
      assert.match(error.message, /unavailable in the current chapter/);
      assert.equal(error.completedCommands, 1);
      assert.equal(error.commandIndex, 1);
      return true;
    },
  );
});

test('a failed initial rebuild preserves an addressable last good preview', async () => {
  const source = await mkdtemp(join(tmpdir(), 'story-session-recovery-'));
  let server;
  try {
    await mkdir(join(source, 'dist'));
    await writeFile(
      join(source, 'dist/index.html'),
      '<!doctype html><HTML><BODY><script>const example="</body>";</script><p>Last good scene</p></BODY></HTML>',
    );
    server = await develop(source, 0, {
      build: async () => {
        throw new Error('Current edit cannot compile');
      },
    });
    const state = await requestSession(server.url, 'status');
    assert.equal(state.error, 'Current edit cannot compile');
    assert.match(state.built.revision, /^[a-f0-9]+$/);
    const document = parse(await fetch(server.url).then((r) => r.text()));
    const body = document.childNodes
      .find((n) => n.tagName === 'html')
      .childNodes.find((n) => n.tagName === 'body');
    const client = body.childNodes.find(
      (n) => n.tagName === 'script' && n.attrs.some((a) => a.name === 'data-visual-story-client'),
    );
    assert.equal(client.attrs.find((a) => a.name === 'data-revision').value, state.built.revision);
    assert.equal(
      body.childNodes.find((n) => n.tagName === 'script').childNodes[0].value,
      'const example="</body>";',
    );
  } finally {
    await server?.close();
    await rm(source, { recursive: true, force: true });
  }
});

test('a preview session pins shown content, controls semantics and restores a cue after retiming', async () => {
  const source = await mkdtemp(join(tmpdir(), 'story-session-'));
  let server, browser;
  const code = (
    end,
  ) => `import {SceneShell} from '@visual-storytelling/core';import '@visual-storytelling/core/style.css';
    window.galleryReady=(async()=>{await SceneShell.ready();const root=document.querySelector('main');
      const shell=SceneShell.mount(root,{title:'Session',parameters:[{key:'x',label:'Value',value:1,min:0,max:10},
        {key:'extra',label:'Extra',type:'toggle',value:false},{key:'beta',label:'Beta',value:2,min:0,max:10}]});
      const label=document.createElement('p');shell.stage.append(label);
      shell.attachStory({script:{duration:${end + 2},cues:{move:{start:1,end:${end},action:'Move the object'}}},
        stateAt:f=>({x:1+f.progress('move'),extra:false,beta:2}),
        render:v=>{label.textContent='Value '+v.x;shell.describeParameter('beta',{disabled:!v.extra});}});
    })();`;
  try {
    await writeFile(
      join(source, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"></head><body><main class="ve-scene"></main><script type="module" src="scene.js"></script></body></html>',
    );
    await writeFile(join(source, 'scene.js'), code(5));
    server = await develop(source, 0, { sourcePackage: true });
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.waitForFunction(() => document.querySelector('main')?.scene?.inspect);
    await page.waitForFunction(() => document.documentElement.dataset.visualStoryRevision);
    const before = await requestSession(server.url, 'inspect');
    assert.equal(before.result.duration, 7);
    const found = await requestSession(server.url, 'find', { query: 'move object' });
    assert.equal(found.result[0].id, 'move');
    const controlled = await requestSession(server.url, 'control', {
      commands: [{ type: 'pause' }, { type: 'cue', id: 'move', progress: 0.5 }],
    });
    assert.equal(controlled.result.time, 3);
    await assert.rejects(
      requestSession(server.url, 'control', {
        revision: 'stale',
        commands: [{ type: 'seek', time: 0 }],
      }),
      /revision changed/,
    );
    await assert.rejects(
      requestSession(server.url, 'control', {
        commands: [
          { type: 'seek', time: 0 },
          { type: 'parameters', values: { x: 100 } },
        ],
      }),
      /Invalid scene parameter/,
    );
    assert.equal(
      (await requestSession(server.url)).result.time,
      0,
      'a completed seek remains applied when the following command rejects its current conditions',
    );
    await requestSession(server.url, 'control', {
      commands: [{ type: 'cue', id: 'move', progress: 0.5 }],
    });
    await writeFile(join(source, 'scene.js'), code(9));
    await page.waitForFunction(
      (old) =>
        document.documentElement.dataset.visualStoryRevision &&
        document.documentElement.dataset.visualStoryRevision !== old,
      before.revision,
    );
    const after = await requestSession(server.url);
    assert.equal(after.result.time, 5);
    assert.notEqual(after.revision, before.revision);
    const explore = await requestSession(server.url, 'control', {
      commands: [{ type: 'parameters', values: { x: 7 } }],
    });
    assert.equal(explore.result.mode, 'explore');
    assert.equal(explore.result.parameters.find((p) => p.key === 'x').value, 7);
    await writeFile(join(source, 'scene.js'), 'export const = ;');
    await page.locator('#visual-story-build-error').waitFor();
    await writeFile(join(source, 'scene.js'), code(9));
    await page.waitForFunction(() => !document.querySelector('#visual-story-build-error'));
    const recovered = await requestSession(server.url);
    assert.equal(
      recovered.revision,
      after.revision,
      'returning to identical output needs no reload',
    );
    assert.equal(recovered.result.parameters.find((p) => p.key === 'x').value, 7);
    await writeFile(join(source, 'scene.js'), code(10));
    await page.waitForFunction(
      (old) => document.documentElement.dataset.visualStoryRevision !== old,
      recovered.revision,
    );
    const disabled = await requestSession(server.url);
    assert.equal(disabled.result.mode, 'explore');
    assert.equal(disabled.result.parameters.find((p) => p.key === 'x').value, 7);
    assert.equal(disabled.result.parameters.find((p) => p.key === 'beta').disabled, true);
    await requestSession(server.url, 'control', {
      commands: [
        { type: 'parameters', values: { extra: true } },
        { type: 'parameters', values: { beta: 8 } },
      ],
    });
    await writeFile(join(source, 'scene.js'), code(11));
    await page.waitForFunction(
      (old) => document.documentElement.dataset.visualStoryRevision !== old,
      disabled.revision,
    );
    const restored = await requestSession(server.url);
    assert.equal(restored.result.parameters.find((p) => p.key === 'beta').value, 8);
    assert.equal(restored.result.parameters.find((p) => p.key === 'beta').disabled, false);
    assert.equal(await page.locator('#visual-story-build-error').count(), 0);
    const foreign = await fetch(server.url + '/__visual_story_session', {
      method: 'POST',
      headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(foreign.status, 403);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(source, { recursive: true, force: true });
  }
});
