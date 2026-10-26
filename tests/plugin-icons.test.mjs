import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('the sidebar app publishes both theme icons through MCP', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const data = await mkdtemp(join(tmpdir(), 'story-icons-'));
  const client = new Client({ name: 'icon-check', version: '1.0.0' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(root, 'plugin/dist/server.mjs')],
        env: { ...process.env, VISUAL_STORY_DATA_DIR: data },
      }),
    );
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    const app = tools.find((tool) => tool.name === 'story_open');
    const resource = resources.find((item) => item.uri === app._meta.ui.resourceUri);
    const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
    const presentation = manifest.extensions['com.openai'].interface;
    const expected = await Promise.all(
      Object.entries({
        light: presentation.composerIcon,
        dark: presentation.composerIconDark,
      }).map(async ([theme, path]) => ({
        src: `data:image/svg+xml;base64,${(await readFile(join(root, path))).toString('base64')}`,
        mimeType: 'image/svg+xml',
        sizes: ['any'],
        theme,
      })),
    );
    for (const owner of [client.getServerVersion(), app, resource])
      assert.deepEqual(owner.icons, expected, owner.name);
    assert.ok(tools.some((tool) => tool.name !== 'story_open' && !tool.icons));
  } finally {
    await client.close();
    await rm(data, { recursive: true, force: true });
  }
});
