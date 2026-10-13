import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

function silentWave(seconds = 8) {
  const samples = seconds * 8000;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return 'data:audio/wav;base64,' + bytes.toString('base64');
}

test(
  'voiced authoring prepares isolated clocks, keeps playback choices and rejects stale speech',
  { timeout: 120000 },
  async () => {
    const source = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import {IllustratedStory} from './src/story/illustrated.ts';
      import {divisionStory} from './src/recipes/division-story.ts';
      const mountDocument = async(root, source, options={}) => (await IllustratedStory.mount(root,{...options,document:source})).scene;
      import './dist/style.css';
      const audio = document.querySelector('audio');
      audio.src = ${JSON.stringify(silentWave())};
      audio.volume = 0;
      const documentValue = divisionStory({inputs:{count:17,divisor:5}});
      ['Соберём предметы.', 'Разделим на группы.', 'Посмотрим на остаток.'].forEach((text, index) => documentValue.chapters[0].beats[index].say = text);
      const alignment = {duration:8,cues:{'experience.gather':{start:0,end:1.2},'experience.group':{start:1.2,end:5.2},'experience.remainder':{start:5.2,end:8}},segments:[{id:'experience',start:0,end:8,text:'Соберём предметы. Разделим на группы. Посмотрим на остаток.'}]};
      audio.dataset.storyTimeline = 'data:application/json,' + encodeURIComponent(JSON.stringify(alignment));
      window.media = [audio]; window.commands = []; window.maxRunning = 0;
      const countRunning = () => {window.maxRunning = Math.max(window.maxRunning, window.media.filter(audio => !audio.paused).length);};
      const nativeClone = audio.cloneNode;
      HTMLAudioElement.prototype.cloneNode = function(...args) {const clone = nativeClone.apply(this,args); window.media.push(clone); return clone;};
      const nativePause = HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.pause = function() {window.commands.push({id:window.media.indexOf(this),op:'pause'}); nativePause.call(this); countRunning();};
      const nativePlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {window.commands.push({id:window.media.indexOf(this),op:'play'}); const pending = nativePlay.call(this); countRunning(); return pending.then(value=>{countRunning();return value;});};
      const nativeTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {...nativeTime, set(value) {window.commands.push({id:window.media.indexOf(this),op:'seek',value}); if(window.failCandidateSeek && this !== window.acceptedAudio) throw Error('injected candidate seek'); nativeTime.set.call(this,value);}});
      window.acceptedAudio = audio;
      window.ready = new Promise(resolve => {if(audio.readyState>=1)resolve();else audio.addEventListener('loadedmetadata',resolve,{once:true});}).then(async()=>{
        const scene = await mountDocument(document.querySelector('main'), documentValue, {audio});
        window.lab = {scene, audio, documentValue, alignment};
      });
    `,
      },
      bundle: true,
      write: false,
      outdir: 'artifacts/unified-authoring/voiced-source-bundle',
      format: 'iife',
      plugins: [assetURLs()],
      loader: { '.woff2': 'dataurl' },
      define: { 'import.meta.url': 'document.baseURI' },
    });
    const browser = await chromium.launch(
      chromiumLaunchOptions({ args: ['--autoplay-policy=no-user-gesture-required'] }),
    );
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(
        '<!doctype html><html lang="ru"><body><main class="ve-scene"></main><audio data-story-audio preload="auto"></audio></body></html>',
      );
      await page.addStyleTag({
        content: source.outputFiles.find((file) => file.path.endsWith('.css')).text,
      });
      await page.addScriptTag({
        content: source.outputFiles.find((file) => file.path.endsWith('.js')).text,
      });
      await page.evaluate(() => window.ready);
      await page.evaluate(async () => {
        await lab.scene.control([
          { type: 'mode', value: 'explore' },
          { type: 'parameters', values: { count: 18 } },
        ]);
        lab.scene.seek(2);
        lab.scene.setRate(1.25);
        await lab.scene.play();
      });
      await page.waitForFunction(() => !lab.audio.paused);
      const observe = () =>
        page.evaluate(() => ({
          document: lab.scene.authoring.document,
          snapshot: lab.scene.snapshot(),
          playing: lab.scene.inspect({ presentation: false }).playing,
          time: lab.scene.currentTime,
          mode: lab.scene.inspect({ presentation: false }).mode,
          rate: lab.scene.rate,
          muted: lab.scene.muted,
          ids: [...document.querySelectorAll('[data-division-role]')].map(
            (node) => node.dataset.object,
          ),
          media: window.media.map((audio) => ({
            paused: audio.paused,
            src: audio.src,
            muted: audio.muted,
            rate: audio.playbackRate,
            volume: audio.volume,
            time: audio.currentTime,
          })),
          commands: window.commands,
          maxRunning: window.maxRunning,
          source: lab.audio.outerHTML,
        }));
      const before = await observe();
      assert.equal(before.snapshot.count, 18);
      assert.equal(before.mode, 'explore');
      const mismatches = await page.evaluate(async () => {
        const results = [];
        for (const change of [
          (doc) => (doc.chapters[0].beats[0].say = 'Теперь предметов совсем другое количество.'),
          (doc) => (doc.chapters[0].beats[0].say = 'Соберём предметы!'),
          (doc) => {
            doc.chapters[0].beats[0].say = 'Соберём';
            doc.chapters[0].beats[1].say = 'предметы. Разделим на группы.';
          },
          (doc) => (doc.narration = { ...doc.narration, intro: 1 }),
          (doc) => (doc.narration = { ...doc.narration, outro: 2 }),
          (doc) => (doc.narration = { ...doc.narration, pause: 1.5 }),
        ]) {
          const next = structuredClone(lab.scene.authoring.document);
          change(next);
          let validation, replacement;
          try {
            lab.scene.authoring.validate(next);
          } catch (error) {
            validation = error.message;
          }
          try {
            await lab.scene.authoring.replace(next);
          } catch (error) {
            replacement = error.message;
          }
          results.push({ validation, replacement });
        }
        return results;
      });
      for (const mismatch of mismatches) {
        assert.match(mismatch.validation, /Prepare new audio and acoustic timing/);
        assert.match(mismatch.replacement, /Prepare new audio and acoustic timing/);
      }
      let after = await observe();
      assert.deepEqual(after.document, before.document);
      assert.deepEqual(after.snapshot, before.snapshot);
      assert.equal(after.media.length, 1, 'stale speech is rejected before preparing media');
      assert.equal(after.source, before.source, 'export retains the immutable original resource');
      assert.equal(after.playing, true);
      assert.deepEqual(
        after.commands,
        before.commands,
        'validation never pauses or seeks the active clip',
      );

      for (const failure of ['abort', 'seek']) {
        const start = await observe();
        const result = await page.evaluate(async (failure) => {
          const next = structuredClone(lab.scene.authoring.document);
          next.title = 'Rejected candidate';
          const abort = new AbortController();
          window.failCandidateSeek = failure === 'seek';
          const replacing = lab.scene.authoring.replace(next, { signal: abort.signal });
          if (failure === 'abort') abort.abort();
          try {
            await replacing;
          } catch (error) {
            return error.message;
          } finally {
            window.failCandidateSeek = false;
          }
        }, failure);
        assert.match(result, failure === 'abort' ? /abort/i : /injected candidate seek/);
        after = await observe();
        assert.deepEqual(after.document, start.document);
        assert.deepEqual(after.snapshot, start.snapshot);
        assert.deepEqual(after.ids, start.ids);
        assert(after.time >= start.time);
        assert.equal(after.playing, true);
        assert.equal(after.rate, 1.25);
        assert.equal(after.muted, false);
        assert.deepEqual(
          after.commands.slice(start.commands.length).filter((command) => command.id === 0),
          [],
          'rejected candidate never pauses or seeks accepted audio',
        );
        assert(after.media.slice(1).every((audio) => audio.paused));
      }
      await page.evaluate(async () => {
        const next = structuredClone(lab.scene.authoring.document);
        next.title = 'Accepted revision';
        await lab.scene.authoring.replace(next);
        window.acceptedAudio = window.media.at(-1);
      });
      await page.waitForFunction(() => !window.acceptedAudio.paused);
      after = await observe();
      assert.equal(after.document.title, 'Accepted revision');
      assert.equal(after.playing, true);
      assert.equal(after.rate, 1.25);
      assert.equal(after.muted, false);
      assert.equal(after.media.at(-1).src, before.media[0].src);
      assert.equal(after.media.filter((audio) => !audio.paused).length, 1);
      assert.equal(after.maxRunning, 1);
      assert.equal(after.source, before.source);
      assert(after.time >= before.time);

      await page.evaluate(async () => {
        lab.scene.setRate(1.75);
        await lab.scene.mute(true);
        window.acceptedAudio.volume = 0.2;
      });
      const accepted = await observe();
      await page.evaluate(async () => {
        const next = structuredClone(lab.scene.authoring.document);
        next.title = 'Another revision';
        await lab.scene.authoring.replace(next);
        window.acceptedAudio = window.media.at(-1);
      });
      await page.waitForFunction(() => !window.acceptedAudio.paused);
      after = await observe();
      assert.equal(after.rate, 1.75);
      assert.equal(after.muted, true);
      assert.equal(
        after.media.at(-1).volume,
        0.2,
        'preferences come from the latest accepted clone',
      );
      assert.equal(
        after.media[0].muted,
        false,
        'the export source was not used as a second preference store',
      );
      assert.equal(after.maxRunning, 1);
      assert.deepEqual(after.ids, accepted.ids);
      assert.deepEqual(after.snapshot, accepted.snapshot);
      assert.equal(after.mode, accepted.mode);

      const pausedFailure = await page.evaluate(async () => {
        lab.scene.pause();
        const condition = lab.scene.condition,
          before = lab.scene.snapshot(),
          svg = document.querySelector('[data-division]').outerHTML;
        const next = structuredClone(lab.scene.authoring.document);
        next.title = 'Abort paused candidate';
        const abort = new AbortController();
        const replacing = lab.scene.authoring.replace(next, { signal: abort.signal });
        abort.abort();
        try {
          await replacing;
        } catch {}
        return {
          sameCondition: lab.scene.condition === condition,
          sameFrame: document.querySelector('[data-division]').outerHTML === svg,
          before,
          after: lab.scene.snapshot(),
          paused: window.acceptedAudio.paused,
        };
      });
      assert.equal(pausedFailure.sameCondition, true);
      assert.equal(pausedFailure.sameFrame, true);
      assert.deepEqual(pausedFailure.before, pausedFailure.after);
      assert.equal(pausedFailure.paused, true);
      assert.deepEqual(errors, []);
      await page.evaluate(() => lab.scene.dispose());
    } finally {
      await browser.close();
    }
  },
);
