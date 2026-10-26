import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { authoringTools } from '../plugin/mcp/authoring-tools.mjs';
import { validateStoryDocument } from '../dist/story/document.js';

test('MCP accepts subject-only creation, returns canonical documents, and rejects incomplete model inputs', async (t) => {
  const server = new McpServer({ name: 'live-input-server', version: '1' });
  const client = new Client({ name: 'live-input-client', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const received = [];
  authoringTools(
    server,
    {
      async call(method, args) {
        assert.equal(method, 'create');
        received.push(args);
        // The real kernel uses this same pure owner before it creates a project.
        return { document: validateStoryDocument(args.document) };
      },
    },
    'ui://visual-story/input-test',
    (handler) => handler,
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const create = (document) =>
    client.callTool({
      name: 'story_create',
      arguments: { title: 'Числа и группы', requestId: randomUUID(), document },
    });
  const tool = (await client.listTools()).tools.find((tool) => tool.name === 'story_create');
  const schema = tool.inputSchema.properties.document;
  assert.equal(schema.type, 'object');
  assert.equal(schema.properties, undefined, 'transport does not duplicate domain validation');
  const minimal = { recipe: 'division', inputs: { count: 17, divisor: 5 } };
  const created = await create(minimal);
  assert.equal(created.isError, undefined, JSON.stringify(created));
  assert.deepEqual(received[0].document, minimal, 'schema forwards to the shared normalizer');
  assert.deepEqual(created.structuredContent.document, validateStoryDocument(minimal));
  assert.equal(created.structuredContent.document.version, 2);
  assert.deepEqual(created.structuredContent.document.models[0], {
    id: 'division',
    module: 'division',
    inputs: { count: 17, divisor: 5 },
  });
  for (const inputs of [{}, { count: 17 }, { divisor: 5 }])
    assert.equal((await create({ recipe: 'division', inputs })).isError, true);
  assert.equal(received.length, 4, 'malformed domain input reaches the core validator');
  const explicit = {
    recipe: 'division',
    id: 'apples',
    title: 'Собственный порядок',
    inputs: { count: 21, divisor: 5 },
    views: [{ id: 'objects', kind: 'groups', model: 'apples' }],
    chapters: [
      {
        id: 'experience',
        title: 'Группы',
        beats: [{ id: 'collect', operation: { model: 'apples', name: 'group' }, seconds: 3 }],
      },
    ],
  };
  const custom = await create(explicit);
  assert.equal(custom.isError, undefined, JSON.stringify(custom));
  assert.deepEqual(custom.structuredContent.document, validateStoryDocument(explicit));
  const canonical = await create(custom.structuredContent.document);
  assert.equal(canonical.isError, undefined, JSON.stringify(canonical));
  assert.deepEqual(canonical.structuredContent.document, custom.structuredContent.document);
  const staticScene = await create({ ...minimal, chapters: [] });
  assert.equal(staticScene.isError, undefined, JSON.stringify(staticScene));
  assert.deepEqual(staticScene.structuredContent.document.chapters, []);
});
