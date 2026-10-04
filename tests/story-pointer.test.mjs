import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// The pointer is a visual consumer of the same actions, including at arbitrary seeks.
test('story pointer: scaled approach, click, type/caret, rewind and disposal have no input side effects', async () => {
  const bundle = await build({
    stdin: {
      contents: `
      import { storyActions, cueSheet } from './dist/story/index.js';
      import './dist/styles/interface.css';
      const container = document.querySelector('#film'), input = document.querySelector('#email'), button = document.querySelector('#send');
      const cues = cueSheet({duration:8,cues:{type:{start:1,end:3},press:{start:4,end:4.4},select:{start:5,end:5.6}}});
      window.events=[];
      for(const type of ['focus','click','input','change'])container.addEventListener(type,()=>events.push(type),true);
      window.actions=storyActions([
        {cue:'type',type:'type',target:input,text:'A👨‍👩‍👧‍👦 test'},
        {cue:'press',type:'press',target:button,result:document.querySelector('#result')},
        {cue:'select',type:'select',target:document.querySelector('#choice')},
      ],{pointer:container});
      window.render=(time,reduced=false,visible=true)=>{
        // Deliberately update subject visibility after action rendering, as existing scenes do.
        actions.render(cues.at(time,reduced));
        document.querySelector('#panel').hidden=!visible;
      };
      render(0);
      `,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    outdir: '.',
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.setContent(
      `<div id="film"><div id="panel"><input id="email" readonly><button id="send">Send</button><input id="choice" type="checkbox"><span id="result">Done</span></div></div>`,
    );
    await page.addStyleTag({
      content: `body{margin:0}#film{width:800px;height:500px;transform:scale(.5);transform-origin:0 0}#email{position:absolute;left:150px;top:100px;width:250px;height:60px;padding:0 14px;border:1px solid #999;font:24px Arial;border-radius:8px}#send{position:absolute;left:490px;top:280px;width:130px;height:55px}#choice{position:absolute;left:500px;top:390px}#result{position:absolute;top:350px;left:460px}`,
    });
    await page.addStyleTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
    });
    const render = (time, reduced = false, visible = true) =>
      page.evaluate(([t, r, v]) => render(t, r, v), [time, reduced, visible]);
    const state = () =>
      page.evaluate(() => {
        const get = (selector) => document.querySelector(selector),
          rect = (e) => {
            const r = e.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          },
          cursor = get('.ve-story-pointer'),
          caret = get('.ve-story-caret');
        return {
          value: get('#email').value,
          selected: get('#choice').checked,
          result: get('#result').hidden,
          cursor: {
            hidden: cursor.hidden,
            transform: cursor.style.transform,
            opacity: cursor.style.opacity,
            rect: rect(cursor),
            down: cursor.hasAttribute('data-down'),
          },
          caret: { hidden: caret.hidden, rect: rect(caret) },
          focusHidden: get('.ve-story-focus').hidden,
          rippleHidden: get('.ve-story-click').hidden,
          active: document.activeElement.tagName,
          events: [...events],
          input: rect(get('#email')),
          button: rect(get('#send')),
        };
      });
    assert.equal((await state()).cursor.hidden, true);
    await render(0.7);
    const approaching = await state();
    assert.equal(approaching.cursor.hidden, false);
    assert(
      approaching.cursor.rect.x < approaching.input.x + 20,
      'cursor approaches the field in scaled coordinates',
    );
    assert.equal(approaching.focusHidden, true, 'approach does not focus the field early');
    await render(1.1);
    const typing = await state();
    assert.equal(typing.focusHidden, false);
    assert.equal(typing.caret.hidden, false);
    assert(
      typing.caret.rect.x >= typing.input.x &&
        typing.caret.rect.x < typing.input.x + typing.input.width,
    );
    assert(
      typing.caret.rect.y >= typing.input.y &&
        typing.caret.rect.y + typing.caret.rect.height <= typing.input.y + typing.input.height,
    );
    assert.equal(typing.rippleHidden, false);
    assert.equal(typing.active, 'BODY');
    assert.deepEqual(typing.events, []);
    await render(2.2);
    const middle = await state();
    assert(middle.value.startsWith('A👨‍👩‍👧‍👦'), 'grapheme stays whole');
    await render(3);
    assert.equal((await state()).value, 'A👨‍👩‍👧‍👦 test');
    await render(4.06);
    const press = await state();
    assert.equal(press.cursor.down, true);
    assert(Math.abs(press.cursor.rect.x + 1 - press.button.x - press.button.width / 2) < 0.01);
    assert.equal(press.result, true);
    await render(4.4);
    assert.equal((await state()).result, false);
    await render(5);
    assert.equal((await state()).selected, true);
    await render(2.2);
    assert.deepEqual(
      await state(),
      middle,
      'rewind reproduces caret, geometry, text and media pose',
    );
    await render(0.7, true);
    assert.equal((await state()).cursor.hidden, true, 'reduced motion skips pre-cue travel');
    await render(1.7, true);
    assert.equal((await state()).caret.hidden, false, 'reduced motion keeps a steady caret');
    assert.equal((await state()).rippleHidden, true);
    await render(4.06, false, false);
    assert.equal(
      (await state()).cursor.hidden,
      true,
      'hidden target does not inherit the previous frame geometry',
    );
    await render(4.06, false, true);
    assert.deepEqual(await state(), press, 'reappearing target measures after subject render');
    // A container resize changes pointer geometry with the composition, without a separate observer/clock.
    await page.locator('#film').evaluate((e) => (e.style.transform = 'scale(.8)'));
    await render(4.06);
    const resized = await state();
    assert(
      Math.abs(resized.cursor.rect.x + 1.6 - resized.button.x - resized.button.width / 2) < 0.01,
    );
    const disposal = await page.evaluate(() => {
      render(2.2); // Queue a final measurement, then dispose before its microtask runs.
      actions.dispose();
      actions.dispose();
      return {
        value: document.querySelector('#email').value,
        position: document.querySelector('#film').style.position,
      };
    });
    assert.deepEqual(disposal, { value: '', position: '' });
    assert.equal(await page.locator('.ve-story-pointer-layer').count(), 0);
    assert.deepEqual(await page.evaluate(() => events), []);
  } finally {
    await browser.close();
  }
});

test('typing follows the text end through nested scale and restores field scrolling on rewind and dispose', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { storyActions, cueSheet } from './dist/story/index.js';
        import './dist/styles/interface.css';
        const input = document.querySelector('input'), area = document.querySelector('textarea');
        input.value = 'Original long field with a scrolled starting position';
        area.value = 'Original one\\nOriginal two\\nOriginal three\\nOriginal four\\nOriginal five';
        input.scrollLeft = 37;
        area.scrollTop = 24;
        window.original = [input, area].map(e => ({value:e.value,left:e.scrollLeft,top:e.scrollTop}));
        const cues = cueSheet({duration:7,cues:{input:{start:1,end:2},area:{start:3,end:4},clear:{start:5,end:6}}});
        const actions = storyActions([
          {cue:'input',type:'type',target:input,text:'A long replacement ending here'},
          {cue:'area',type:'type',target:area,text:'Line one\\nLine two\\nLine three\\nLine four\\nThe final wrapped line'},
          {cue:'clear',type:'type',target:input,text:''},
        ],{pointer:document.querySelector('#film')});
        window.render = time => actions.render(cues.at(time,true));
        window.dispose = () => actions.dispose();
      `,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    outdir: '.',
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="film"><div id="panel"><input readonly><textarea readonly></textarea></div></div>',
    );
    await page.addStyleTag({
      content: `
      body{margin:0}#film{width:600px;height:400px}
      #panel{position:absolute;left:60px;top:60px;transform:scale(.5);transform-origin:0 0}
      input,textarea{display:block;box-sizing:border-box;font:20px/24px monospace;padding:6px;border:1px solid}
      input{width:120px;height:40px}textarea{width:160px;height:68px;margin-top:20px;resize:none;scrollbar-gutter:stable}
    `,
    });
    await page.addStyleTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
    });
    const fields = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('input,textarea')].map((e) => ({
          value: e.value,
          left: e.scrollLeft,
          top: e.scrollTop,
        })),
      );
    const seek = (time) => page.evaluate((t) => render(t), time);
    const caret = (selector) =>
      page.evaluate((selector) => {
        const target = document.querySelector(selector),
          cursor = document.querySelector('.ve-story-caret');
        const rect = target.getBoundingClientRect(),
          shown = cursor.getBoundingClientRect();
        return {
          hidden: cursor.hidden,
          height: shown.height,
          inside:
            shown.left >= rect.left &&
            shown.right <= rect.right &&
            shown.top >= rect.top &&
            shown.bottom <= rect.bottom,
        };
      }, selector);
    const original = await page.evaluate(() => window.original);
    await seek(0);
    assert.deepEqual(await fields(), original, 'before the first cue preserve the initial scroll');
    await seek(2);
    const inputState = await fields();
    assert(inputState[0].left > 37, 'the final characters scroll into view');
    assert.deepEqual(await caret('input'), { hidden: false, height: 12, inside: true });
    await seek(4);
    const areaState = await fields();
    assert(areaState[1].top > 24, 'the textarea follows its final line');
    assert.deepEqual(await caret('textarea'), { hidden: false, height: 12, inside: true });
    await seek(2);
    assert.deepEqual(await fields(), inputState, 'backward seek reproduces scroll for every field');
    await seek(4);
    assert.deepEqual(await fields(), areaState, 'forward seek reproduces the multiline viewport');
    await seek(0);
    assert.deepEqual(await fields(), original);
    await seek(6);
    assert.equal((await fields())[0].value, '');
    await page.evaluate(() => dispose());
    assert.deepEqual(await fields(), original, 'restore text before its original scroll offsets');
  } finally {
    await browser.close();
  }
});
