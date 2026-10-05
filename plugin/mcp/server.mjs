import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions, OpenAIFileEntrypointInputSchema } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimeClient } from '../runtime/client.mjs';
import { command, sessionId, read, changeView, viewReport, acknowledgement } from './schema.mjs';
import { presentSession, toolResult } from './presentation.mjs';
import { authoringTools } from './authoring-tools.mjs';
import manifest from '../../plugin.json' with { type: 'json' };
import { errorData } from '../errors.mjs';

const directory = dirname(process.argv[1]);
process.env.PATH = join(directory, '../../runtime/bin') + ':' + process.env.PATH;
const html = await readFile(join(directory, 'app.html'), 'utf8');
const runtime = runtimeClient(directory);
const request = (sessionId, request) => runtime.call('request', { sessionId, request });
const server = new McpServer({
  name: 'visual-storytelling',
  title: 'Visual Storytelling',
  version: manifest.version,
});
new OpenAIExtensions(server);
const uri = `ui://visual-storytelling/${manifest.version}/${createHash('sha256').update(html).digest('hex').slice(0, 12)}/app.html`;
const result = (value, text = JSON.stringify(value)) => ({
  content: [{ type: 'text', text }],
  structuredContent: value,
});
const safely = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error.message }],
      structuredContent: { error: errorData(error) },
    };
  }
};
registerAppResource(server, 'Визуальное объяснение', uri, {}, async () => ({
  contents: [
    {
      uri,
      mimeType: RESOURCE_MIME_TYPE,
      text: html,
      _meta: {
        ui: {
          prefersBorder: false,
          csp: { connectDomains: [], resourceDomains: ['data:', 'blob:'], frameDomains: ['blob:'] },
        },
        'openai/ui': {
          availableDisplayModes: ['inline', 'fullscreen'],
          preferredDisplayMode: 'inline',
        },
      },
    },
  ],
}));

registerAppTool(
  server,
  'story_open',
  {
    title: 'Визуальное объяснение',
    description:
      'Open Visual Storytelling in chat. With no arguments opens a ready interactive example. Reuse sessionId to move the same live scene between views. Commands use the existing view and do not create another card.',
    inputSchema: {
      sessionId: sessionId.optional(),
      projectId: z.string().uuid().optional(),
      path: z.string().optional(),
      example: z.string().optional(),
      file: OpenAIFileEntrypointInputSchema.shape.file.optional(),
    },
    annotations: changeView,
    _meta: {
      ui: { resourceUri: uri, visibility: ['model', 'app'] },
      'openai/ui': {
        entrypoints: [
          { type: 'global' },
          { type: 'thread' },
          { type: 'file', extensions: ['.vstory'] },
        ],
      },
    },
  },
  safely(async (args) =>
    args.file ? { content: [] } : toolResult(presentSession(await runtime.call('open', args))),
  ),
);

server.registerTool(
  'story_navigate',
  {
    description:
      'Visit an additional explanation in the existing panel, preserving a return point. Back returns to the paused lesson. Use story_open only for a new card or to explicitly reuse a session.',
    inputSchema: {
      sessionId,
      back: z.boolean().optional(),
      target: z
        .object({
          sessionId: sessionId.optional(),
          projectId: z.string().uuid().optional(),
          path: z.string().optional(),
          example: z.string().optional(),
        })
        .optional(),
    },
    annotations: changeView,
  },
  safely(async (args) => toolResult(presentSession(await runtime.call('navigate', args)))),
);

server.registerTool(
  'story_inspect',
  {
    description:
      'Read the displayed scene, working project or persistent job. No IDs lists active sessions. sessionId + file reads the shown build source with shown and working revisions; projectId + file reads working UTF-8 source. A project returns sourceRevision and file hashes. A session returns compact state and capabilities. Request model for object values and causal inputs, timeline for all cues, or presentation for geometry.',
    inputSchema: {
      sessionId: sessionId.optional(),
      projectId: z.string().uuid().optional(),
      file: z.string().optional(),
      jobId: z.string().uuid().optional(),
      detail: z.enum(['state', 'model', 'timeline', 'presentation']).default('state'),
    },
    annotations: read,
  },
  safely(async ({ sessionId, projectId, file, jobId, detail }) => {
    if (jobId) return result(await runtime.call('job', { jobId }));
    if (sessionId && file) return result(await runtime.call('shownSource', { sessionId, file }));
    if (projectId) return result(await runtime.call('project', { projectId, file }));
    return sessionId
      ? toolResult(presentSession(await request(sessionId, { op: 'inspect', detail }), detail))
      : result({ sessions: (await runtime.call('list')).map((s) => presentSession(s)) });
  }),
);
server.registerTool(
  'story_find',
  {
    description:
      'Find live cues, chapters or semantic objects by narration, action, title, label or ID. Ranked results identify their type. Use cue control for cues, seek for chapter start, select/focus for objects.',
    inputSchema: { sessionId, query: z.string().min(1).max(500) },
    annotations: read,
  },
  safely(async ({ sessionId, query }) =>
    toolResult(presentSession(await request(sessionId, { op: 'find', query }))),
  ),
);
server.registerTool(
  'story_control',
  {
    description:
      'Control the existing live scene through its SceneHandle. Supply the inspected buildRevision and stateRevision, plus a unique requestId. Pause alone needs no prior inspection. Retries reuse the result. Acknowledgement is rendered after preparation and two frame opportunities, or prepared if the host defers repaint. Neither confirms screenshot pixels or a camera transition ending.',
    inputSchema: {
      sessionId,
      buildRevision: z.string().optional(),
      stateRevision: z.number().int().nonnegative().optional(),
      requestId: z.string().min(8).max(100),
      commands: z.array(command).min(1).max(32),
    },
    annotations: changeView,
  },
  safely(async ({ sessionId, ...args }) =>
    toolResult(presentSession(await request(sessionId, { op: 'control', ...args }))),
  ),
);

registerAppTool(
  server,
  'story_view',
  {
    description: 'Private MCP App lifecycle and delivery channel. Never call from the model.',
    inputSchema: {
      sessionId,
      renderer: z.string().uuid(),
      generation: z.number().int().optional(),
      action: z.enum(['attach', 'exchange', 'detach', 'candidate', 'replace', 'focus', 'widget']),
      widget: z
        .object({
          id: z.string().min(1).max(120),
          snapshot: z.object({
            modelContent: z.unknown().optional(),
            privateContent: z.unknown().optional(),
          }),
        })
        .optional(),
      buildRevision: z.string().optional(),
      phase: z.enum(['prepare', 'commit', 'abort']).optional(),
      replacementId: z.string().uuid().optional(),
      report: viewReport.optional(),
      acknowledgements: z.array(acknowledgement).max(32).optional(),
      wait: z.boolean().optional(),
    },
    annotations: changeView,
    _meta: { ui: { visibility: ['app'] } },
  },
  safely(async ({ action, ...args }) => {
    if (action === 'attach' || action === 'candidate') {
      const { html, ...state } = await runtime.call(action, args);
      return { ...result(state), _meta: { sceneHTML: html } };
    }
    return result(await runtime.call(action, args));
  }),
);
authoringTools(server, runtime, uri, safely);
server.server.onclose = () => runtime.close();
process.on('exit', () => runtime.close());
await server.connect(new StdioServerTransport());
