import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve } from '../tools/site.mjs';

test('preview serves precise ranges of long media and preserves HTML injection', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'story-media-'));
  let server;
  t.after(async () => {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });
  const size = 128 * 1024 * 1024,
    ending = Buffer.from('last-frame');
  const file = await open(join(root, 'long.wav'), 'w');
  try {
    await file.truncate(size);
    await file.write(ending, 0, ending.length, size - ending.length);
  } finally {
    await file.close();
  }
  await writeFile(join(root, 'index.html'), '<main>Scene</main>');
  server = await serve(root, 0, { html: (text) => text + '<script>ready()</script>' });
  const head = await fetch(server.url + '/long.wav', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(size));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const range of [
    `bytes=${size - ending.length}-`,
    `bytes=-${ending.length}`,
    `bytes=${size - ending.length}-${size + 100}`,
  ]) {
    const response = await fetch(server.url + '/long.wav', { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(
      response.headers.get('content-range'),
      `bytes ${size - ending.length}-${size - 1}/${size}`,
    );
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), ending);
  }
  for (const range of [`bytes=${size}-`, 'bytes=20-10', 'bytes=-0']) {
    const response = await fetch(server.url + '/long.wav', { headers: { Range: range } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), `bytes */${size}`);
    await response.arrayBuffer();
  }
  const html = await fetch(server.url + '/');
  assert.equal(await html.text(), '<main>Scene</main><script>ready()</script>');
});
