import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { openFixture } from './support/fixture.mjs';

const execute = promisify(execFile);
test('ordinary silent audio hooks retain accepted timing through the shared document mount', async () => {
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await openFixture(page, 'speech-units', 'silent.html');
    const state = await page.locator('main').evaluate((root) => ({
      duration: root.scene.duration,
      hasAudio: !!root.scene.mute,
      contexts: window.outputContexts.length,
    }));
    assert.deepEqual(state, { duration: 8, hasAudio: false, contexts: 0 });
  } finally {
    await browser.close();
  }
});
async function recordedRMS(page, evidence) {
  await mkdir(evidence, { recursive: true });
  await writeFile(evidence + '/output.webm', Buffer.from(await page.evaluate(() => outputBytes())));
  const { stdout } = await execute(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      evidence + '/output.webm',
      '-f',
      'f32le',
      '-ac',
      '1',
      '-ar',
      '24000',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 2000000 },
  );
  const samples = new Float32Array(
    stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength),
  );
  return (from, until) => {
    const span = samples.slice(Math.round(from * 24000), Math.round(until * 24000));
    return Math.sqrt(span.reduce((sum, value) => sum + value * value, 0) / span.length);
  };
}
test(
  'native audio output closes before a future take during a stalled UI and resumes only at a shown whole thought',
  { timeout: 20000 },
  async () => {
    const browser = await chromium.launch(
      chromiumLaunchOptions({
        args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
      }),
    );
    const evidence = 'artifacts/slice11/native-output';
    await mkdir(evidence, { recursive: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openFixture(page, 'speech-units');
      await page.evaluate(async () => {
        outputRecorder.start(50);
        await lab.scene.play();
        lab.shell.input({ count: 18 });
      });
      await page.waitForFunction(() => lab.scene.currentTime >= 1.5);
      const stalled = await page.evaluate(() => {
        const before = lab.scene.currentTime;
        const stop = performance.now() + 2000;
        while (performance.now() < stop) {}
        return { before, after: lab.scene.currentTime };
      });
      // Native currentTime is stable within one JS task; read its advanced value in the next task.
      stalled.after = await page.evaluate(() => lab.scene.currentTime);
      assert(stalled.before < 2 && stalled.after > 3.2, JSON.stringify(stalled));
      await page.waitForFunction(() => lab.scene.currentTime >= 4.3);
      const generic = await page.evaluate(() => ({
        speech: lab.story.player.state.speech,
        muted: lab.scene.muted,
        count: lab.story.presented.values.count,
      }));
      assert.equal(generic.count, 18);
      assert.equal(generic.speech.audible, true);
      assert.equal(generic.muted, false);
      await page.waitForFunction(() => lab.scene.currentTime >= 7.9);
      const rms = await recordedRMS(page, evidence);
      const levels = {
        generic: rms(0.4, 1.5),
        wrong: rms(2.3, 3.6),
        nextGeneric: rms(4.4, 5.5),
        wrongAgain: rms(6.3, 7.5),
      };
      await writeFile(
        evidence + '/receipt.json',
        JSON.stringify({ stalled, generic, levels, errors }, null, 2),
      );
      assert(levels.generic > 0.02 && levels.nextGeneric > 0.02, JSON.stringify(levels));
      assert(levels.wrong < 0.001 && levels.wrongAgain < 0.001, JSON.stringify(levels));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  '3× rate immediately reschedules the output fence and a skipped generic head stays quiet',
  { timeout: 15000 },
  async () => {
    const browser = await chromium.launch(
      chromiumLaunchOptions({
        args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
      }),
    );
    try {
      const page = await browser.newPage();
      await openFixture(page, 'speech-units');
      await page.evaluate(async () => {
        outputRecorder.start(50);
        await lab.scene.play();
        lab.shell.input({ count: 18 });
      });
      await page.waitForFunction(() => lab.scene.currentTime >= 0.8);
      const before = await page.evaluate(() => {
        const before = lab.scene.currentTime;
        lab.scene.setRate(3);
        const end = performance.now() + 1500;
        while (performance.now() < end) {}
        return before;
      });
      await page.waitForFunction(() => lab.scene.currentTime >= 7.8);
      const evidence = 'artifacts/slice11/native-rate';
      const rms = await recordedRMS(page, evidence);
      const levels = {
        generic: rms(0.3, 0.7),
        wrong: rms(1.4, 1.7),
        skippedGeneric: rms(2.2, 2.4),
      };
      await writeFile(evidence + '/receipt.json', JSON.stringify({ before, levels }, null, 2));
      assert(
        levels.generic > 0.02 && levels.wrong < 0.001 && levels.skippedGeneric < 0.001,
        JSON.stringify(levels),
      );
    } finally {
      await browser.close();
    }
  },
);

test('failed native graph preparation preserves the accepted document and audio owner and permits a retry', async () => {
  const browser = await chromium.launch(
    chromiumLaunchOptions({ args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] }),
  );
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, 'speech-units');
    const proof = await page.evaluate(async () => {
      const old = lab.story,
        original = JSON.stringify(lab.scene.authoring.document);
      const next = structuredClone(lab.scene.authoring.document);
      next.models[0].inputs.count = 18;
      const prototype = MediaElementAudioSourceNode.prototype,
        connect = prototype.connect;
      let once = true,
        error;
      prototype.connect = function (...args) {
        if (once) {
          once = false;
          throw Error('output connection failed');
        }
        return connect.apply(this, args);
      };
      try {
        await lab.scene.authoring.replace(next);
      } catch (cause) {
        error = cause.message;
      } finally {
        prototype.connect = connect;
      }
      const preserved = {
        sameController: lab.story === old,
        sameSource: JSON.stringify(lab.scene.authoring.document) === original,
        count: lab.scene.snapshot().count,
      };
      await lab.scene.authoring.replace(next);
      const retryCount = lab.scene.snapshot().count;
      for (let i = 0; i < 9; i++) await lab.scene.authoring.replace(next);
      const resources = {
        contexts: outputContexts.length,
        audio: document.querySelectorAll('audio').length,
      };
      await lab.scene.play();
      return { error, preserved, retryCount, resources, hasAudio: lab.story.player.state.hasAudio };
    });
    assert.equal(proof.error, 'output connection failed');
    assert.deepEqual(proof.preserved, { sameController: true, sameSource: true, count: 17 });
    assert.equal(proof.retryCount, 18);
    assert.equal(proof.hasAudio, true);
    assert.deepEqual(proof.resources, { contexts: 1, audio: 1 });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test(
  'a rate change after a slow task cannot reopen an already expired output fence',
  { timeout: 15000 },
  async () => {
    const browser = await chromium.launch(
      chromiumLaunchOptions({
        args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
      }),
    );
    try {
      const page = await browser.newPage();
      await openFixture(page, 'speech-units');
      await page.evaluate(async () => {
        outputRecorder.start(50);
        await lab.scene.play();
        lab.shell.input({ count: 18 });
      });
      await page.waitForFunction(() => lab.scene.currentTime >= 0.8);
      await page.evaluate(() => {
        const wait = (seconds) => {
          const end = performance.now() + seconds * 1000;
          while (performance.now() < end) {}
        };
        wait(1.5);
        lab.scene.setRate(3);
        wait(0.6);
      });
      await page.waitForFunction(() => lab.scene.currentTime >= 7.8);
      const evidence = 'artifacts/slice11/native-stale-rate';
      const rms = await recordedRMS(page, evidence);
      const levels = { generic: rms(0.3, 0.7), expired: rms(2.4, 2.65) };
      await writeFile(evidence + '/receipt.json', JSON.stringify(levels, null, 2));
      assert(levels.generic > 0.02 && levels.expired < 0.001, JSON.stringify(levels));
    } finally {
      await browser.close();
    }
  },
);

test(
  'unmute checks the current output head instead of replaying its cached pre-word permission',
  { timeout: 15000 },
  async () => {
    const browser = await chromium.launch(
      chromiumLaunchOptions({
        args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
      }),
    );
    try {
      const page = await browser.newPage();
      await openFixture(page, 'speech-units');
      await page.evaluate(async () => {
        outputRecorder.start(50);
        await lab.scene.play();
        await lab.scene.mute(true);
        const end = performance.now() + 700;
        while (performance.now() < end) {}
        await lab.scene.mute(false);
      });
      await page.waitForFunction(() => lab.scene.currentTime >= 3.8);
      const evidence = 'artifacts/slice11/native-stale-unmute';
      const rms = await recordedRMS(page, evidence);
      const levels = { muted: rms(0.2, 0.5), fragment: rms(0.8, 1.05), nextThought: rms(2.4, 3.5) };
      await writeFile(evidence + '/receipt.json', JSON.stringify(levels, null, 2));
      assert(
        levels.muted < 0.001 && levels.fragment < 0.001 && levels.nextThought > 0.02,
        JSON.stringify(levels),
      );
      assert.equal(await page.evaluate(() => lab.scene.muted), false);
    } finally {
      await browser.close();
    }
  },
);

test('a native setter failure rolls the transfer back to the accepted controller before a retry', async () => {
  const browser = await chromium.launch(
    chromiumLaunchOptions({ args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] }),
  );
  try {
    const page = await browser.newPage();
    await openFixture(page, 'speech-units');
    const proof = await page.evaluate(async () => {
      const previous = lab.story,
        source = JSON.stringify(lab.scene.authoring.document);
      const next = structuredClone(lab.scene.authoring.document);
      next.models[0].inputs.count = 18;
      const prototype = HTMLMediaElement.prototype,
        descriptor = Object.getOwnPropertyDescriptor(prototype, 'playbackRate');
      let once = true,
        error;
      Object.defineProperty(prototype, 'playbackRate', {
        ...descriptor,
        set(value) {
          if (once) {
            once = false;
            throw Error('native rate setter failed');
          }
          descriptor.set.call(this, value);
        },
      });
      try {
        await lab.scene.authoring.replace(next);
      } catch (cause) {
        error = cause.message;
      } finally {
        Object.defineProperty(prototype, 'playbackRate', descriptor);
      }
      const preserved = {
        controller: lab.story === previous,
        source: JSON.stringify(lab.scene.authoring.document) === source,
        count: lab.scene.snapshot().count,
      };
      await lab.scene.authoring.replace(next);
      return {
        error,
        preserved,
        retryCount: lab.scene.snapshot().count,
        contexts: outputContexts.length,
      };
    });
    assert.equal(proof.error, 'native rate setter failed');
    assert.deepEqual(proof.preserved, { controller: true, source: true, count: 17 });
    assert.equal(proof.retryCount, 18);
    assert.equal(proof.contexts, 1);
  } finally {
    await browser.close();
  }
});

test('detaching a recorded controller removes every forwarded capability and retains the static scene handle', async () => {
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    await openFixture(page, 'speech-units');
    const result = await page.evaluate(() => {
      const handle = lab.scene;
      lab.shell.detachController();
      return {
        same: document.querySelector('main').scene === handle,
        speech: handle.speech,
        ownSpeech: Object.hasOwn(handle, 'speech'),
        seek: typeof handle.seek,
        muted: handle.muted,
        review: handle.review(),
      };
    });
    assert.equal(result.same, true);
    assert.equal(result.ownSpeech, false);
    assert.equal(result.speech, undefined);
    assert.equal(result.seek, 'undefined');
    assert.deepEqual(result.review, { duration: 0, cues: [], segments: [] });
  } finally {
    await browser.close();
  }
});
