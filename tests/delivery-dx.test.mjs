import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { videoFrames } from '../tools/motion/media.mjs';
import { subjectDigests } from '../tools/motion/subject-digests.mjs';
import { buildEpisodes } from '../tools/motion/episodes.mjs';
import { exportVideo } from '../tools/video-export.mjs';
import { deliver } from '../tools/deliver.mjs';
import { setNarrationMode } from '../tools/narration.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { svgRuntime } from '../tools/svg-runtime.mjs';

const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'pipe' });
test('review decodes only written images at nonzero source PTS and at a bounded frame count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-pts-'));
  try {
    const video = join(directory, 'offset.mp4');
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=64x48:rate=30:duration=4',
      '-vf',
      'setpts=PTS+3/TB',
      '-fps_mode',
      'passthrough',
      '-c:v',
      'libx264',
      video,
    ]);
    for (const [name, count, seconds] of [
      ['interval', undefined, 1.17],
      ['count', 7, undefined],
    ]) {
      const frames = await videoFrames(video, 4, count, seconds, join(directory, name));
      assert.equal(frames.length, count ?? 36);
      for (const frame of frames) {
        assert(frame.time >= 4 && (seconds === undefined || frame.time < 5.17));
        assert((await readFile(frame.file)).length > 0);
      }
      assert.equal((await readdir(join(directory, name, 'capture'))).length, frames.length);
    }
    const replace = join(directory, 'interval');
    await videoFrames(video, 4, 4, undefined, replace);
    assert.equal((await readdir(join(replace, 'capture'))).length, 4);
    const previous = await readFile(join(replace, 'capture/000000001.png'));
    await assert.rejects(videoFrames(video, 20, 4, undefined, replace), /at least two/);
    assert.deepEqual(await readFile(join(replace, 'capture/000000001.png')), previous);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('moving player pixels do not conceal a static subject or a static bound input', async () => {
  const base = await sharp({ create: { width: 80, height: 60, channels: 4, background: 'white' } })
    .png()
    .toBuffer();
  const altered = await sharp(base)
    .composite([
      {
        input: await sharp({ create: { width: 20, height: 5, channels: 4, background: 'black' } })
          .png()
          .toBuffer(),
        left: 0,
        top: 55,
      },
    ])
    .png()
    .toBuffer();
  const regions = [
    { id: '$subject', x: 0, y: 0, width: 80, height: 50 },
    { id: 'input', x: 10, y: 10, width: 30, height: 20 },
  ];
  const samples = await Promise.all(
    [base, altered].map(async (png, time) => ({
      time,
      id: String(time),
      digest: String(time),
      subjects: await subjectDigests(png, regions),
    })),
  );
  const cue = { id: 'type', start: 0, end: 1, kind: 'action', referenced: true };
  for (const targets of [undefined, ['input']]) {
    const episode = buildEpisodes(samples, {
      context: { review: { cues: [{ ...cue, targets }], segments: [] } },
    })[0];
    assert(episode.observations.some((text) => text.includes('одинаковы')));
  }
  samples[1].subjects.input = 'changed';
  const [episode] = buildEpisodes(samples, {
    context: { review: { cues: [{ ...cue, targets: ['input'] }], segments: [] } },
  });
  assert.equal(episode.observations.length, 0);
});

test('parallel video export has continuous frame indices and audio, and failed output preserves the prior file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'parallel-film-'));
  try {
    const runtime = await svgRuntime({ '': ['mountScene'] });
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=3',
      '-af',
      "volume='if(between(t,0.8,1.0)+between(t,1.6,1.8),1,0)':eval=frame",
      join(directory, 'audio.wav'),
    ]);
    const html = (fail) =>
      `<!doctype html><body style="margin:0"><main class="ve-scene" style="position:relative;width:400px;height:240px;background:white"><audio><source src="audio.wav"></audio><output style="font:80px sans-serif"></output><div id="marker" style="position:absolute;top:200px;width:10px;height:10px;background:red"></div></main><script>${runtime};VisualStory.mountScene(document.querySelector('main'),{duration:3,dispose(){},pause(){},seek(t){${fail ? "if(t>1)throw new Error('subject failed');" : ''}document.querySelector('output').textContent=Math.round(t*8);document.querySelector('#marker').style.left=Math.round(t*8)*10+'px'}});</script>`;
    await writeFile(join(directory, 'index.html'), html(false));
    const packed = await packDirectory(directory);
    assert.match(packed, /<source src="data:audio\/mp4;base64,/);
    assert(
      !packed.includes('data:audio/wav'),
      'source-based narration uses delivery compression too',
    );
    const offline = join(directory, 'offline.html');
    await writeFile(offline, packed);
    const bundle = await build({
      stdin: {
        contents: `import { mediaTimeline } from './src/story/clock.ts'; window.mediaTimeline=mediaTimeline;`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: 'iife',
      write: false,
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ offline: true });
      await page.goto(pathToFileURL(offline).href);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => {
        const audio = document.querySelector('audio');
        audio.preload = 'metadata';
        const clock = window.mediaTimeline(audio, 3, () => {});
        clock.seek(0);
        for (let i = 0; i < 15; i++) {
          clock.seek(1.5);
          clock.seek(0);
        }
        const play = document.createElement('button');
        play.id = 'play';
        play.textContent = 'Play';
        play.addEventListener('click', () => void audio.play());
        document.body.append(play);
      });
      await page.locator('#play').click();
      await page.waitForFunction(
        () => document.querySelector('audio').currentTime > 0.15,
        undefined,
        { timeout: 3000 },
      );
      await page.locator('audio').evaluate((audio) => audio.pause());
    } finally {
      await browser.close();
    }
    const output = join(directory, 'film.mp4');
    const receipt = await exportVideo({
      directory,
      output,
      theme: 'light',
      width: 440,
      from: 0.5,
      to: 2.5,
      fps: 8,
      jobs: 3,
    });
    assert.equal(receipt.frames, 16);
    assert(receipt.chunks >= 3);
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', output],
        { encoding: 'utf8' },
      ),
    );
    const video = probe.streams.find((stream) => stream.codec_type === 'video');
    assert.equal(Number(video.nb_read_frames), 16);
    assert.equal(video.width, 440, 'output width does not shrink to the captured subject width');
    assert.equal(video.height, 248, 'default video fits the subject into a 16:9 output');
    const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
    assert(Math.abs(Number(audio.duration) - 2) < 0.03);
    const frames = await videoFrames(output, 0, undefined, undefined, join(directory, 'decoded'));
    assert.equal(frames.length, 16);
    for (let i = 0; i < frames.length; i++) assert(Math.abs(frames[i].time - i / 8) < 0.00001);
    const scale = Math.min(video.width / 400, video.height / 240);
    const inset = (video.width - 400 * scale) / 2;
    let initialPosition;
    for (let i = 0; i < frames.length; i++) {
      const { data, info } = await sharp(frames[i].file)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let xsum = 0,
        pixels = 0;
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++) {
          const at = (y * info.width + x) * info.channels;
          if (data[at] > 170 && data[at + 1] < 70 && data[at + 2] < 70) {
            xsum += x;
            pixels++;
          }
        }
      assert(pixels > 0);
      const position = xsum / pixels;
      if (i === 0) {
        initialPosition = position;
        // YUV420 padding is aligned to two-pixel chroma blocks.
        assert(Math.abs(position - (inset + 44.5 * scale)) < 2);
      }
      assert(
        Math.abs(position - initialPosition - i * 10 * scale) < 1.5,
        `frame ${i} preserves its scene time across chunks`,
      );
    }
    const pcm = ffmpeg(['-i', output, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1']);
    const active = [];
    for (let offset = 0; offset + 320 <= pcm.length; offset += 320) {
      let energy = 0;
      for (let i = 0; i < 80; i++) energy += pcm.readFloatLE(offset + i * 4) ** 2;
      if (energy / 80 > 0.0004) active.push(offset / 4 / 8000);
    }
    assert(
      Math.abs(active[0] - 0.3) < 0.04,
      'the first audio pulse follows the selected --from offset',
    );
    assert(
      Math.abs(active.at(-1) - 1.3) < 0.04,
      'one continuous audio encode spans all video chunks',
    );
    const prior = await readFile(output);
    await writeFile(join(directory, 'index.html'), html(true));
    await assert.rejects(
      exportVideo({ directory, output, theme: 'light', width: 400, fps: 4, jobs: 2 }),
      /subject failed/,
    );
    assert.deepEqual(await readFile(output), prior);
    await writeFile(join(directory, 'index.html'), html(false));
    const abort = new AbortController();
    await assert.rejects(
      exportVideo({
        directory,
        output,
        theme: 'light',
        width: 400,
        fps: 8,
        jobs: 2,
        signal: abort.signal,
        onProgress: () => abort.abort(new Error('cancelled by author')),
      }),
      /cancelled by author/,
    );
    assert.deepEqual(await readFile(output), prior);
    assert(!(await readdir(directory)).some((name) => name.startsWith('.visual-story-video-')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a nested release keeps editable sources, captions and silent HTML together', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-delivery-'));
  try {
    const html =
      '<main class="ve-scene"><audio data-silent=true src="missing.wav"><source src="missing.mp3"></audio></main><script>const example="<audio data-silent=\'true\'>";</script>';
    assert(setNarrationMode(html, false).includes('const example="<audio data-silent=\'true\'>"'));
    assert(!setNarrationMode(html, false).includes('<audio  data-silent'));
    const runtime = await svgRuntime({ '': ['mountScene'] });
    const script = {
      duration: 2,
      cues: [],
      segments: [{ id: 'one', text: 'Готово.', start: 0, end: 2 }],
    };
    await writeFile(join(directory, 'index.html'), html + '<script src="scene.js"></script>');
    await writeFile(
      join(directory, 'scene.js'),
      `${runtime};VisualStory.mountScene(document.querySelector('main'),{dispose(){},review:()=>(${JSON.stringify(script)})});`,
    );
    await writeFile(
      join(directory, 'package.json'),
      '{"name":"plain-illustration","private":true}',
    );
    await writeFile(join(directory, 'timeline.json'), JSON.stringify({ ...script, cues: {} }));
    const payload = Buffer.from([0, 1, 127, 128, 255, 13, 10]);
    const payloadPath = join(directory, 'authored.bin');
    await writeFile(payloadPath, payload);
    if (process.platform === 'darwin')
      execFileSync('xattr', [
        '-w',
        'org.visual-storytelling.test',
        'authored metadata',
        payloadPath,
      ]);
    const out = join(directory, 'artifacts/release');
    await mkdir(out, { recursive: true });
    const activeExport = await mkdtemp(join(out, '.visual-story-video-'));
    await writeFile(join(activeExport, 'parts.txt'), 'active excerpt');
    await writeFile(join(out, 'neuron-excerpt.mp4'), 'previous independent excerpt');
    const receipt = await deliver(directory, {
      out,
      formats: ['html', 'srt', 'vtt', 'source'],
      silent: true,
    });
    assert.match(receipt.runtime.build, /^[a-f0-9]{64}$/);
    const packed = await readFile(join(out, 'story.html'), 'utf8');
    assert(!packed.includes('src="missing.wav"'));
    assert.match(await readFile(join(out, 'story.srt'), 'utf8'), /00:00:00,000 --> 00:00:02,000/);
    const entries = execFileSync('tar', ['-tzf', join(out, 'source.tar.gz')], {
      encoding: 'utf8',
    }).split('\n');
    assert(entries.includes('source/index.html'));
    assert(entries.includes('source/package.json'));
    // macOS tar -t hides AppleDouble entries, so inspect the actual tar headers.
    const archive = gunzipSync(await readFile(join(out, 'source.tar.gz')));
    for (let offset = 0; offset + 512 <= archive.length && archive[offset]; ) {
      const name = archive.toString('utf8', offset, offset + 100).split('\0')[0];
      assert(!name.split('/').some((part) => part.startsWith('._')), name);
      const size = parseInt(archive.toString('ascii', offset + 124, offset + 136), 8);
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    assert.deepEqual(
      execFileSync('tar', ['-xOf', join(out, 'source.tar.gz'), 'source/authored.bin']),
      payload,
    );
    assert.deepEqual(await readFile(payloadPath), payload);
    assert(
      !entries.some(
        (path) =>
          path.includes('/artifacts/') ||
          path.includes('/dist/') ||
          path.includes('.visual-story-build-'),
      ),
    );
    const previous = await readFile(join(out, 'delivery.json'));
    const abort = new AbortController();
    abort.abort(new Error('cancelled before release'));
    await assert.rejects(
      deliver(directory, { out, silent: true, signal: abort.signal }),
      /cancelled before release/,
    );
    assert.deepEqual(await readFile(join(out, 'delivery.json')), previous);
    await deliver(directory, { out, formats: ['html'], silent: true });
    assert.equal(await readFile(join(activeExport, 'parts.txt'), 'utf8'), 'active excerpt');
    await writeFile(join(activeExport, 'finished.mp4'), 'export continued in the same directory');
    assert.equal(
      await readFile(join(out, 'neuron-excerpt.mp4'), 'utf8'),
      'previous independent excerpt',
    );
    await assert.rejects(readFile(join(out, 'story.srt')), { code: 'ENOENT' });
    const priorHTML = await readFile(join(out, 'story.html'));
    await rm(join(out, 'delivery.json'));
    await assert.rejects(
      deliver(directory, { out, formats: ['html'], silent: true }),
      /does not own/,
    );
    assert.deepEqual(await readFile(join(out, 'story.html')), priorHTML);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
