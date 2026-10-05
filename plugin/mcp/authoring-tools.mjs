import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { read, changeView } from './schema.mjs';
import { presentSession, toolResult } from './presentation.mjs';

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const projectId = z.string().uuid();
export function authoringTools(server, runtime, uri, safely) {
  const result = (value, text) => ({ content: [{ type: 'text', text }], structuredContent: value });
  registerAppTool(
    server,
    'story_create',
    {
      title: 'Создать визуальное объяснение',
      description:
        'Create an editable local project from a shipped example and open its progress in one MCP App. No voice model is required. The result includes source paths, projectId and jobId. Use story_help to choose a template; edit source files through story_edit.',
      inputSchema: {
        title: z.string().min(1).max(160),
        example: z.string().default('explorer-svg'),
        path: z.string().optional(),
        requestId,
      },
      annotations: changeView,
      _meta: { ui: { resourceUri: uri, visibility: ['model', 'app'] } },
    },
    safely(async (args) => toolResult(presentSession(await runtime.call('create', args)))),
  );
  server.registerTool(
    'story_edit',
    {
      description:
        'Apply one undoable authoring edit to a working project, then prepare its changed scene. Read sourceRevision and files through story_inspect first. Each change replaces a UTF-8 file; null deletes it. Undo checks for external edits. The current viewer remains usable while preparing.',
      inputSchema: {
        projectId,
        sourceRevision: z.string(),
        requestId,
        undo: z.boolean().optional(),
        changes: z
          .array(
            z.object({
              path: z.string().min(1).max(500),
              content: z.string().max(1_000_000).nullable(),
            }),
          )
          .min(1)
          .max(64)
          .optional(),
      },
      annotations: changeView,
    },
    safely(async (args) =>
      result(await runtime.call('edit', args), 'Правка сохранена; новая версия готовится.'),
    ),
  );
  server.registerTool(
    'story_produce',
    {
      description:
        'Produce HTML, video, captions or an editable source archive locally from a fixed project revision. Returns a persistent job; inspect it for progress and actual artifact paths. Closing the viewer does not cancel production. Video requires local Chromium and FFmpeg.',
      inputSchema: {
        projectId,
        sourceRevision: z.string(),
        requestId,
        options: z
          .object({
            formats: z
              .array(z.enum(['html', 'mp4', 'source', 'srt', 'vtt']))
              .min(1)
              .default(['html']),
            width: z.number().int().min(320).max(3840).optional(),
            height: z.number().int().min(240).max(3840).optional(),
            fps: z.number().int().min(1).max(60).optional(),
            theme: z.enum(['light', 'dark']).optional(),
            silent: z.boolean().optional(),
          })
          .default({ formats: ['html'] }),
      },
      annotations: changeView,
    },
    safely(async (args) => result(await runtime.call('produce', args), 'Готовлю выпуск.')),
  );
  server.registerTool(
    'story_cancel',
    {
      description:
        'Cancel a queued or running preparation/export. Cancellation is confirmed after its worker releases resources.',
      inputSchema: { jobId: z.string().uuid() },
      annotations: changeView,
    },
    safely(async (args) =>
      result(await runtime.call('cancel', args), 'Отмена подготовки запрошена.'),
    ),
  );
  server.registerTool(
    'story_help',
    {
      description:
        'Discover recent projects, shipped example templates or precise public API declarations. Query a public API name to read only that declaration. Source paths point to this installed release.',
      inputSchema: { query: z.string().max(300).optional() },
      annotations: read,
    },
    safely(async (args) => {
      const value = await runtime.call(args.query ? 'help' : 'catalog', args);
      return result(value, value.text ?? 'Доступные проекты и основы.');
    }),
  );
}
