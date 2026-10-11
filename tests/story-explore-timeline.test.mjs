import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('a temporal experiment survives seek and Play; Story and chapter selection restore authored inputs', async () => {
  const bundled = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import { SceneShell } from './src/scene.ts';
        const shell = SceneShell.mount(document.querySelector('main'), {
          title: 'Moving courier', parameters: [{key:'speed',label:'Speed',value:1,min:0,max:10}],
        });
        const controller = shell.attachStory({
          exploreTimeline: true,
          script: {duration:10,cues:{},segments:[
            {id:'start',title:'Start',text:'Start',start:0,end:5},
            {id:'finish',title:'Finish',text:'Finish',start:5,end:10},
          ]},
          stateAt: () => ({speed:1}),
          derive: (p, frame) => ({...p,position:p.speed*frame.time}),
          render: state => shell.stage.textContent=String(state.position),
        });
        window.lab={shell,controller,scene:document.querySelector('main').scene};`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent('<main style="width:1000px"></main>');
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const state = () => page.evaluate(() => lab.controller.requested);
    await page.evaluate(() =>
      lab.scene.control([
        { type: 'parameters', values: { speed: 3 } },
        { type: 'seek', time: 4 },
      ]),
    );
    assert.deepEqual((await state()).state, { speed: 3, position: 12 });
    assert.equal((await state()).mode, 'explore');
    await page.evaluate(() => lab.scene.control([{ type: 'seek', time: 2 }]));
    assert.deepEqual((await state()).state, { speed: 3, position: 6 });
    await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
    await page.waitForFunction(() => lab.controller.currentTime > 2.02);
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    assert.equal((await state()).values.speed, 3);
    assert.equal((await state()).mode, 'explore');
    await page.locator('[data-mode="story"]').click();
    assert.equal((await state()).values.speed, 1);
    assert.equal((await state()).mode, 'story');
    await page.evaluate(() => lab.shell.input({ speed: 4 }));
    await page.getByRole('combobox', { name: 'Глава', exact: true }).click();
    await page.getByRole('option', { name: 'Finish', exact: true }).click();
    assert.deepEqual((await state()).state, { speed: 1, position: 5 });
    assert.equal((await state()).mode, 'story');
    await page.evaluate(() => lab.shell.dispose());
  } finally {
    await browser.close();
  }
});
