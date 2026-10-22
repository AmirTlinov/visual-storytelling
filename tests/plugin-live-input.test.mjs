import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { authoringTools } from '../plugin/mcp/authoring-tools.mjs';
import { validateExplanation } from '../dist/explanation/document.js';

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
        return { document: validateExplanation(args.explanation) };
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
  const create = (explanation) =>
    client.callTool({
      name: 'story_create',
      arguments: { title: 'Числа и группы', requestId: randomUUID(), explanation },
    });
  const tool = (await client.listTools()).tools.find((tool) => tool.name === 'story_create');
  const schema = tool.inputSchema.properties.explanation;
  assert.deepEqual(schema.required, ['model']);
  assert.deepEqual(schema.properties.model.required, ['kind', 'count', 'divisor']);
  const minimal = { model: { kind: 'division', count: 17, divisor: 5 } };
  const created = await create(minimal);
  assert.equal(created.isError, undefined, JSON.stringify(created));
  assert.deepEqual(received[0].explanation, minimal, 'schema forwards to the shared normalizer');
  assert.deepEqual(created.structuredContent.document, {
    version: 1,
    model: { id: 'division', kind: 'division', count: 17, divisor: 5 },
    views: [
      { id: 'groups', kind: 'groups', model: 'division' },
      { id: 'equation', kind: 'equation', model: 'division' },
    ],
  });
  for (const model of [
    { kind: 'division' },
    { kind: 'division', count: 17 },
    { kind: 'division', divisor: 5 },
  ])
    assert.equal((await create({ model })).isError, true);
  assert.equal(received.length, 1, 'incomplete input never reaches project creation');
  const explicit = {
    version: 1,
    title: 'Собственный порядок',
    model: { id: 'apples', kind: 'division', count: 21, divisor: 5 },
    views: [{ id: 'objects', kind: 'groups', model: 'apples' }],
    score: [{ id: 'collect', action: 'group', seconds: 3 }],
  };
  const custom = await create(explicit);
  assert.equal(custom.isError, undefined, JSON.stringify(custom));
  assert.deepEqual(custom.structuredContent.document, explicit);
});
