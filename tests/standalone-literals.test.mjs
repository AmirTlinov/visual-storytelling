import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { packDirectory } from '../tools/standalone.mjs';

test('packing preserves replacement tokens in embedded code and styles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ink-pack-'));
  const literal = "$&$`$'$$";
  const css = `main::after{content:${JSON.stringify(literal)}}`;
  try {
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><main></main><script src="scene.js"></script></body></html>',
    );
    await writeFile(join(directory, 'scene.js'), `window.literal=${JSON.stringify(literal)};`);
    await writeFile(join(directory, 'style.css'), css);
    for (const inline of [false, true]) {
      const packed = await packDirectory(directory, 'index.html', { inline });
      const scripts = [...packed.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
      assert.equal(scripts.length, 1);
      const window = {};
      runInNewContext(scripts[0][1], { window });
      assert.equal(window.literal, literal);
      assert.ok(packed.includes(`<style>${css}</style>`));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
