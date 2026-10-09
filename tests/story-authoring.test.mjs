import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { captionTrack } from '../dist/story/captions.js';

const chapter = (text, words) => ({ id: 'speech', start: 1, end: 8, text, words });
test('captions preserve source typography, word boundaries and aligned time across every delivery', () => {
  const source = '«По-прежнему» e^x — 3,14. Верно?',
    tokens = ['По', 'прежнему', 'e', 'x', '3', '14', 'Верно'];
  const track = captionTrack(
    {
      segments: [
        chapter(
          source,
          tokens.map((text, i) => ({ text, start: 1 + i * 0.5, end: 1.3 + i * 0.5 })),
        ),
      ],
    },
    { maxChars: 19 },
  );
  assert.deepEqual(
    track.segments.map((c) => c.text),
    ['«По-прежнему» e^x —', '3,14. Верно?'],
  );
  assert.equal(track.at(0.9), '');
  assert.equal(track.at(1), '«По-прежнему» e^x —');
  assert.equal(track.at(5), '');
  assert.match(track.serialize('srt'), /1\n00:00:01,000 --> 00:00:02,800\n«По-прежнему» e\^x —/);
  assert.match(track.serialize('vtt'), /^WEBVTT\n\n00:00:01\.000 --> 00:00:02\.800/);
  assert.equal(
    captionTrack({
      segments: [
        chapter('GPT.', [
          { text: 'G', start: 1, end: 1.1 },
          { text: 'P', start: 1.2, end: 1.3 },
          { text: 'T', start: 1.4, end: 1.5 },
        ]),
      ],
    }).at(1),
    'GPT.',
  );
  assert.throws(
    () =>
      captionTrack({
        segments: [
          chapter('один два', [
            { text: 'один', start: 2, end: 3 },
            { text: 'два', start: 1, end: 2 },
          ]),
        ],
      }),
    /Invalid caption time/,
  );
  assert.throws(
    () =>
      captionTrack({
        segments: [chapter('Новая реплика', [{ text: 'Старая', start: 1, end: 2 }])],
      }),
    /does not match/,
  );
});

test('captions rebalance a real sentence tail without losing words or their acoustic intervals', () => {
  const text = 'Вычислим, насколько каждая связь влияет на общий промах, и изменим её.';
  const times = [
    [1430.82022, 1431.36089],
    [1431.96163, 1432.38215],
    [1432.48227, 1432.82269],
    [1432.90279, 1433.18314],
    [1433.24321, 1433.66373],
    [1433.74383, 1433.78388],
    [1433.90403, 1434.18438],
    [1434.24445, 1434.64494],
    [1435.24569, 1435.26571],
    [1435.34581, 1435.78635],
    [1435.92653, 1436.04667],
  ];
  const words = text
    .match(/[\p{L}\p{N}]+/gu)
    .map((text, i) => ({ text, start: times[i][0], end: times[i][1] }));
  const { segments } = captionTrack({
    segments: [{ id: 'tail', start: 1430.8, end: 1436.5, text, words }],
  });
  assert.equal(
    segments
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' '),
    text,
  );
  assert.equal(segments.at(-1).text, 'и изменим её.');
  assert.ok(segments.every((s) => s.end - s.start >= 0.8 - 1e-6));
  assert.ok(
    segments.every(
      (s) => s.text.split('\n').length <= 2 && s.text.split('\n').every((l) => l.length <= 42),
    ),
  );
  for (const word of words)
    assert.ok(segments.some((s) => s.start <= word.start && s.end >= word.end));
});

test('a short isolated caption holds in silence without joining across a pause or the next chapter', () => {
  const track = captionTrack({
    segments: [
      {
        id: 'one',
        start: 0,
        end: 4,
        text: 'Да. Нет.',
        words: [
          { text: 'Да', start: 0.2, end: 0.35 },
          { text: 'Нет', start: 2, end: 2.16 },
        ],
      },
      {
        id: 'two',
        start: 2.5,
        end: 4,
        text: 'Дальше.',
        words: [{ text: 'Дальше', start: 2.7, end: 3.3 }],
      },
    ],
  });
  assert.deepEqual(track.segments, [
    { start: 0.2, end: 1, text: 'Да.' },
    { start: 2, end: 2.5, text: 'Нет.' },
    { start: 2.7, end: 3.5, text: 'Дальше.' },
  ]);
  assert.equal(track.at(1.5), '');
  assert.equal(track.at(2.5), '');
  assert.throws(() => captionTrack({ segments: [] }, { minSeconds: Infinity }), /Caption limits/);
});

test('word-aligned captions accept existing narration receipts without changing the spoken text', async () => {
  for (const name of await readdir(new URL('../examples/', import.meta.url))) {
    let script;
    try {
      script = JSON.parse(
        await readFile(new URL(`../examples/${name}/timeline.json`, import.meta.url)),
      );
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    const track = captionTrack(script);
    assert.equal(
      track.segments
        .map((s) => s.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      script.segments
        .map((s) => s.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      name,
    );
  }
});

test('film authoring: input, response, selection and captions rewind; logical composition isolates subject UI and disposes', async () => {
  const bundle = await build({
    stdin: {
      contents: `
      import { SceneShell } from './dist/scene.js';
      import { storyActions } from './dist/story/actions.js';
      import './dist/style.css';
      window.mountTest = () => {
        const root = document.querySelector('main');
        const shell = SceneShell.mount(root, { title: 'Guide', heading: false, frame: {width:1280,height:720,scope:'scene'}, captions: true });
        shell.stage.insertAdjacentHTML('afterbegin', '<section class="demo"><h1>Свой заголовок</h1><p>Своя подпись</p><div class="controls">Внутреннее управление</div><input id="value" value="AB"><button id="send">Отправить</button><label><input id="choice" type="checkbox">Выбор</label><input type="radio" name="version" id="one" checked><input type="radio" name="version" id="two"><select id="options"><option>Первый</option><option>Второй</option></select><span id="result">Готово</span><span id="reveal" style="display:inline-block;opacity:.6;transform:rotate(5deg);translate:20px 3px">Ответ</span><span id="text"><b>До</b></span></section>');
        const find=id=>shell.stage.querySelector(id);
        const artwork=SceneShell.frame(find('.demo'),{width:1280,height:720});
        shell.stage.append(artwork.element);artwork.resize();shell.onDispose(artwork.dispose);
        const originalChild=find('#text').firstChild;
        const actions = storyActions([
          {cue:'type', type:'type', target:find('#value'),text:'A👨‍👩‍👧‍👦Z'},
          {cue:'press',type:'press',target:find('#send'),result:find('#result')},
          {cue:'select',type:'select',target:find('#choice')},
          {cue:'select',type:'select',target:find('#text')},
          {cue:'option',type:'select',target:find('#two')},
          {cue:'option',type:'select',target:find('#options').options[1]},
          {cue:'reveal',type:'reveal',target:find('#reveal')},
          {cue:'text',type:'type',target:find('#text'),text:'После'},
        ]);
        shell.onDispose(actions.dispose);
        const script = {duration:9,cues:{type:{start:1,end:3,action:'Type code'},press:{start:3,end:4,action:'Confirm'},select:{start:1.5,end:2.5},option:{start:5,end:6},reveal:{start:4,end:6},text:{start:7,end:8}},segments:[{id:'words',start:1,end:2.5,text:'Код — «КОТ».',words:[{text:'Код',start:1,end:1.5},{text:'КОТ',start:2,end:2.5}]}]};
        const controller = shell.attachStory({script,stateAt:f=>f.time,render:(_,frame)=>actions.render(frame)});
        window.lab={root,shell,controller,actions,find,originalChild};
      };`,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    outdir: '.',
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(
      '<main class="ve-scene"></main><aside class="ve-scene legacy"><h1>Эталон</h1></aside>',
    );
    await page.addStyleTag({
      content:
        '.ve-scene.legacy h1{font-size:48px}.demo h1{font-size:52px;margin:7px}.demo p{margin:3px}.demo .controls{display:block}.demo button{border:1px solid blue;background:rgb(12,23,34);color:white}',
    });
    await page.addStyleTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
    });
    assert.equal(
      await page.locator('.legacy h1').evaluate((e) => getComputedStyle(e).fontSize),
      '48px',
    );
    await page.evaluate(() => {
      const Native = ResizeObserver;
      window.liveObservers = new Set();
      window.ResizeObserver = class extends Native {
        observe(...args) {
          liveObservers.add(this);
          super.observe(...args);
        }
        disconnect() {
          liveObservers.delete(this);
          super.disconnect();
        }
      };
      mountTest();
    });
    const seek = (t) => page.evaluate((t) => lab.controller.seek(t), t);
    const state = () =>
      page.evaluate(() => ({
        value: lab.find('#value').value,
        checked: lab.find('#choice').checked,
        radio: [lab.find('#one').checked, lab.find('#two').checked],
        option: lab.find('#options').selectedIndex,
        result: lab.find('#result').hidden,
        reveal: lab.find('#reveal').style.opacity,
        caption: lab.root.querySelector('[data-caption]').textContent,
      }));
    assert.deepEqual(await state(), {
      value: 'AB',
      checked: false,
      radio: [true, false],
      option: 0,
      result: true,
      reveal: '0',
      caption: '',
    });
    await seek(2);
    assert.equal((await state()).value, 'A👨‍👩‍👧‍👦');
    assert.equal((await state()).checked, true);
    assert.equal(await page.locator('#text').getAttribute('aria-selected'), 'true');
    assert.equal(
      await page.locator('#text').evaluate((e) => getComputedStyle(e).outlineStyle),
      'solid',
    );
    assert.equal((await state()).caption, 'Код — «КОТ».');
    await seek(3.5);
    assert.equal(await page.locator('#send').getAttribute('data-story-pressed'), 'true');
    assert.equal(await page.locator('#send').evaluate((e) => getComputedStyle(e).scale), '0.97');
    await page.evaluate(() => lab.controller.setReduced(true));
    assert.equal(await page.locator('#send').evaluate((e) => getComputedStyle(e).scale), 'none');
    await page.evaluate(() => lab.controller.setReduced(false));
    await seek(5);
    assert.equal((await state()).result, false);
    assert.equal((await state()).reveal, '0.3');
    assert.deepEqual((await state()).radio, [false, true]);
    assert.equal((await state()).option, 1);
    await seek(5);
    assert.equal((await state()).reveal, '0.3', 'seeking does not compound opacity');
    await seek(6);
    assert.deepEqual(
      await page.locator('#reveal').evaluate((e) => ({
        opacity: e.style.opacity,
        transform: e.style.transform,
        translate: e.style.translate,
      })),
      { opacity: '0.6', transform: 'rotate(5deg)', translate: '20px 3px' },
    );
    await seek(8);
    assert.equal(await page.locator('#text').textContent(), 'После');
    await seek(0);
    assert.equal(await page.locator('#text').getAttribute('aria-selected'), null);
    assert.equal(
      await page.evaluate(() => lab.find('#text').firstChild === lab.originalChild),
      true,
    );
    assert.deepEqual(await state(), {
      value: 'AB',
      checked: false,
      radio: [true, false],
      option: 0,
      result: true,
      reveal: '0',
      caption: '',
    });
    assert.deepEqual(
      await page.locator('.demo').evaluate((e) => ({
        title: getComputedStyle(e.querySelector('h1')).fontSize,
        margin: getComputedStyle(e.querySelector('p')).marginTop,
        display: getComputedStyle(e.querySelector('.controls')).display,
        button: getComputedStyle(e.querySelector('button')).backgroundColor,
      })),
      { title: '52px', margin: '3px', display: 'block', button: 'rgb(12, 23, 34)' },
    );
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const geometry = await page
        .locator('[data-scene-frame]')
        .first()
        .evaluate((e) => {
          const outer = e.getBoundingClientRect(),
            inner = e.firstElementChild.getBoundingClientRect(),
            controls = document.querySelector('[data-player]').getBoundingClientRect(),
            stage = document.querySelector('.ve-stage').getBoundingClientRect(),
            artwork = document.querySelector('.demo').getBoundingClientRect();
          return {
            outer: outer.width / outer.height,
            inner: inner.width / inner.height,
            aligned: Math.abs(outer.width - inner.width),
            artworkRatio: artwork.width / artwork.height,
            artworkInside:
              artwork.left >= stage.left - 0.1 &&
              artwork.top >= stage.top - 0.1 &&
              artwork.right <= stage.right + 0.1 &&
              artwork.bottom <= stage.bottom + 0.1,
            transportInside:
              controls.top >= stage.bottom - 0.1 && controls.bottom <= outer.bottom + 0.1,
          };
        });
      assert(Math.abs(geometry.outer - 16 / 9) < 0.005);
      assert(Math.abs(geometry.inner - 16 / 9) < 0.005);
      assert(geometry.aligned < 1);
      assert(Math.abs(geometry.artworkRatio - 16 / 9) < 0.005);
      assert(geometry.artworkInside);
      assert(geometry.transportInside);
    }
    assert(
      await page.evaluate(() =>
        lab.controller
          .review()
          .cues.find((c) => c.id === 'press')
          .targets.includes('result'),
      ),
    );
    const lifetime = await page.evaluate(() => {
      lab.shell.dispose();
      lab.shell.dispose();
      let blocked = false;
      try {
        lab.shell.attachStory({
          script: { duration: 1, cues: {} },
          stateAt: () => 0,
          render: () => {},
        });
      } catch {
        blocked = true;
      }
      return {
        observers: liveObservers.size,
        blocked,
        children: lab.root.childElementCount,
        published: !!lab.root.scene,
        text: lab.originalChild.parentElement.textContent,
      };
    });
    assert.deepEqual(lifetime, {
      observers: 0,
      blocked: true,
      children: 0,
      published: false,
      text: 'До',
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
