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
    'story_review',
    {
      description:
        'Review a fixed project revision with its pinned CLI. Returns a persistent job; story_inspect reads progress and the final HTML, frame, and evidence paths. By default captures deterministic scene checkpoints, not playback cadence. Select a cue or time window; scenario names an authored JSON file for a real browser interaction. The source stays unchanged. Use story_cancel or story_retry for interrupted work.',
      inputSchema: {
        projectId,
        sourceRevision: z.string(),
        requestId,
        options: z
          .object({
            cue: z.string().min(1).max(256).optional(),
            from: z.number().finite().nonnegative().optional(),
            seconds: z.number().finite().positive().optional(),
            frames: z.number().int().min(2).max(32).optional(),
            width: z.number().int().min(320).max(3840).optional(),
            height: z.number().int().min(240).max(3840).optional(),
            theme: z.enum(['light', 'dark']).optional(),
            reduced: z.boolean().optional(),
            object: z.string().min(1).max(256).optional(),
            crop: z
              .object({
                x: z.number().finite().nonnegative(),
                y: z.number().finite().nonnegative(),
                width: z.number().finite().positive(),
                height: z.number().finite().positive(),
              })
              .strict()
              .describe('Region in source pixels.')
              .optional(),
            scenario: z.string().min(1).max(500).optional(),
          })
          .strict()
          .refine(
            (options) => !options.scenario || !options.cue,
            'Use a cue for checkpoints, or a scenario for browser interaction.',
          )
          .optional(),
      },
      annotations: changeView,
    },
    safely(async (args) => result(await runtime.call('review', args), 'Готовлю просмотр сцены.')),
  );
  server.registerTool(
    'story_cancel',
    {
      description:
        'Cancel a queued or running preparation, review or export. Cancellation is confirmed after its worker releases resources.',
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
      inputSchema: { query: z.string().max(300).optional(), projectId: projectId.optional() },
      annotations: read,
    },
    safely(async (args) => {
      const value = await runtime.call(args.query ? 'help' : 'catalog', args);
      return result(value, value.text ?? 'Доступные проекты и основы.');
    }),
  );
  server.registerTool(
    'story_retry',
    {
      description:
        'Resume a failed, cancelled or interrupted preparation with its original inputs. Completed dependency and speech stages are reused; incomplete video is rebuilt.',
      inputSchema: { jobId: z.string().uuid(), requestId },
      annotations: changeView,
    },
    safely(async (args) => result(await runtime.call('retry', args), 'Возобновляю подготовку.')),
  );
  server.registerTool(
    'story_migrate',
    {
      description:
        'Explicitly upgrade a project to this plugin’s core. Prepares and builds a separate candidate first, then applies package and lockfile as one undoable authoring edit. The previous runtime archive is retained for story_edit undo. Existing views remain visible during preparation.',
      inputSchema: { projectId, sourceRevision: z.string(), requestId },
      annotations: changeView,
    },
    safely(async (args) =>
      result(await runtime.call('migrate', args), 'Подготавливаю обновление проекта.'),
    ),
  );
  server.registerTool(
    'story_voice',
    {
      description:
        'List available local macOS voices without downloading models. With enabled, update project narration in one undoable edit and prepare synchronized audio/cues. This is distinct from instantly muting playback. A changed phrase reuses unchanged speech fragments.',
      inputSchema: {
        projectId: projectId.optional(),
        sourceRevision: z.string().optional(),
        requestId: requestId.optional(),
        enabled: z.boolean().optional(),
        voice: z.string().max(200).optional(),
        language: z.string().max(35).optional(),
      },
      annotations: changeView,
    },
    safely(async (args) => {
      if (
        args.enabled !== undefined &&
        (!args.projectId || !args.sourceRevision || !args.requestId)
      )
        throw new Error('Changing narration requires projectId, sourceRevision and requestId.');
      return result(
        await runtime.call('voice', args),
        args.enabled === undefined ? 'Доступные голоса.' : 'Подготавливаю рассказ.',
      );
    }),
  );
  registerAppTool(
    server,
    'story_preferences',
    {
      title: 'Настройки Visual Storytelling',
      description:
        'Read or change user defaults for new projects. Existing project content is unchanged.',
      inputSchema: {
        patch: z
          .object({
            projectsDirectory: z.string().min(1).max(1000).optional(),
            language: z.string().min(2).max(35).optional(),
            voice: z.string().max(200).nullable().optional(),
            cacheLimitMB: z.number().int().min(256).max(32768).optional(),
          })
          .strict()
          .optional(),
      },
      annotations: changeView,
      _meta: {
        ui: { resourceUri: uri, visibility: ['model', 'app'] },
        'openai/ui': {
          entrypoints: [{ type: 'settings', searchTerms: ['голос', 'voice', 'projects'] }],
        },
      },
    },
    safely(async (args) => ({
      ...result(await runtime.call('preferences', args), 'Настройки.'),
      _meta: { preferences: true },
    })),
  );
}
