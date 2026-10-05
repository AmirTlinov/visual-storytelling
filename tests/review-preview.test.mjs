import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { captureWriter, saveSession } from '../tools/motion/session.mjs';
import { saveCapture } from '../tools/motion/media.mjs';
import { reportUrl } from '../tools/motion/report-evidence.mjs';
import { previewReport } from '../tools/motion/preview.mjs';

async function cliPreview(directory, t) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../tools/scene.mjs', import.meta.url)),
      'preview',
      directory,
      '--port',
      '0',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await exited;
  });
  let output = '',
    errors = '';
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview did not start: ' + errors)), 15000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error('Preview exited: ' + errors));
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+[^\r\n]*/)?.[0];
      if (url) {
        clearTimeout(timeout);
        resolve(url);
      }
    });
  });
}

test('official preview serves referenced PNG/audio while denying unrelated neighbours and symlinks', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'review-preview-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source frames'),
    report = join(directory, 'report #1');
  const writer = await captureWriter(source);
  const png = await sharp({ create: { width: 8, height: 4, channels: 4, background: '#245678' } })
    .png()
    .toBuffer();
  await writer.append({ time: 0, png });
  await writer.append({ time: 1, png });
  const metadata = { kind: 'frame-manifest' };
  await writer.finish(metadata);
  const audio = join(source, 'voice.wav');
  await writeFile(audio, Buffer.from('captured-audio-range'));
  const outsidePNG = fileURLToPath(
    new URL('../examples/explorer-svg/preview.png', import.meta.url),
  );
  // On macOS this crosses /private/tmp and /Users: the common URL root is '/'.
  const samples = [...writer.frames, { time: 2, file: outsidePNG }];
  const captureManifest = await saveCapture(samples, metadata, report, undefined, { audio });
  await saveSession(report, { captureManifest, source: metadata, samples, episodes: [] });
  const paths = [...samples.map((frame) => frame.file), audio];
  const urls = paths.map((file) => reportUrl(report, file));
  await writeFile(
    join(report, 'index.html'),
    `<main>${urls.map((url) => `<a href="${url}">media</a>`).join('')}</main>`,
  );
  const secret = join(source, 'unrelated.txt');
  await writeFile(secret, 'not part of this report');
  await symlink(secret, join(report, 'leak.txt'));
  const url = await cliPreview(report, t);
  assert.equal(new URL(url).pathname.endsWith('/report%20%231/index.html'), true);
  assert.equal((await fetch(url)).status, 200);
  for (const [i, path] of paths.entries()) {
    const response = await fetch(new URL(urls[i], url));
    assert.equal(response.status, 200, path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path));
  }
  const range = await fetch(new URL(urls.at(-1), url), { headers: { Range: 'bytes=9-13' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), 'audio');
  for (const path of [reportUrl(report, secret), 'leak.txt']) {
    const response = await fetch(new URL(path, url));
    assert.equal(response.status, 403, path);
    await response.arrayBuffer();
  }
  const undeclaredSourceFile = join(dirname(outsidePNG), 'scene.js');
  const denied = await fetch(new URL(reportUrl(report, undeclaredSourceFile), url));
  assert.equal(denied.status, 403);
  await denied.arrayBuffer();
});

test('self-contained reports and ordinary scenes retain the normal HTTP root', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'review-preview-root-'));
  const servers = [];
  t.after(async () => {
    for (const server of servers) await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const writer = await captureWriter(join(directory, 'report'));
  await writer.append({ time: 0, png: Buffer.from('image') });
  const source = { kind: 'frame-manifest' };
  const captureManifest = await writer.finish(source);
  await saveSession(join(directory, 'report'), {
    captureManifest,
    source,
    samples: writer.frames,
    episodes: [],
  });
  await writeFile(join(directory, 'report', 'index.html'), 'Report');
  const scene = join(directory, 'scene');
  await mkdir(scene);
  await writeFile(join(scene, 'index.html'), 'Scene');
  await writeFile(join(scene, 'session.json'), '{"kind":"unrelated-scene-data"}');
  for (const [folder, expected] of [
    ['report', 'Report'],
    ['scene', 'Scene'],
  ]) {
    const server = await previewReport(join(directory, folder), 0);
    servers.push(server);
    assert.equal(new URL(server.url).pathname, '/');
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), expected);
  }
});
