import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { read, changeView, context, contextTarget } from './schema.mjs';

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const projectId = z.string().uuid();
const fileChanges = z
  .array(
    z.object({
      path: z.string().min(1).max(500),
      content: z.string().max(1_000_000).nullable(),
    }),
  )
  .min(1)
  .max(64);
// Transport accepts JSON; the pinned core owns document and operation semantics.
const storyDocumentInput = z.record(z.string(), z.json());
const documentOperations = z.array(z.record(z.string(), z.json())).min(1).max(64);
export function authoringTools(server, runtime, uri, safely) {
  const result = (value, text) => ({ content: [{ type: 'text', text }], structuredContent: value });
  registerAppTool(
    server,
    'story_create',
    {
      title: 'Создать визуальное объяснение',
      description:
        'Create from document:{recipe:"division",inputs:{count,divisor}} or a canonical StoryDocument v2. The pinned core validates and normalizes the complete document. Recipes division, fractions and dependency-route supply short visual stories; chapters:[] creates a real static experiment without playback. Supply context from the open card to reuse it, preserving a Back destination. Repeat the same requestId and arguments to resume unconfirmed delivery. A saved source or prepared build alone is not a shown frame; inspect delivery and acknowledgement. Continue with story_edit operations. Add custom model/subject JS/TS through story-project.json and one story_edit changes transaction; they share the pinned runtime. Runtime is pinned immediately; prepared documents need no per-request npm or compilation. Omit document for a source-code scaffold, or use example="gpt-model" for the exemplar; these use JobRunner and do not accept a scene context.',
      inputSchema: {
        title: z.string().min(1).max(160),
        example: z.string().min(1).optional(),
        document: storyDocumentInput.optional(),
        context: context.optional(),
        path: z.string().optional(),
        requestId,
      },
      annotations: changeView,
      _meta: { ui: { resourceUri: uri, visibility: ['model', 'app'] } },
    },
    safely(async (args) =>
      result(await runtime.call('create', args), 'Редактируемый проект создан.'),
    ),
  );
  server.registerTool(
    'story_edit',
    {
      description:
        'Apply one complete undoable authoring operation. For a live explanation use operations: set-inputs(modelId,values), set-views(views), or set-chapters(chapters). Each payload and the final document are validated before writing; related views/references can change atomically. Explicit input keys override viewer values even when unchanged in the source; other viewer inputs survive. Delivery is shown, prepared, pending or failed: saved source alone is not a rendered result. Retry the same requestId to resume unconfirmed delivery without rewriting; a completed receipt stays historical. The supplied context fences external source changes and binds the scene. Continue from the returned context after success; inspect only for detail or conflict. For source-code extensions use changes (UTF-8 replacement, null deletion); those prepare an immutable candidate before committing. While the job runs, project is the accepted source; on success job.result.project is the committed revision. A failed candidate preserves source, runtime pin and the last working picture. Choose operations, changes or undo.',
      inputSchema: {
        context,
        requestId,
        undo: z.boolean().optional(),
        changes: fileChanges.optional(),
        operations: documentOperations.optional(),
      },
      annotations: changeView,
    },
    safely(async (args) =>
      result(
        await runtime.call('edit', args),
        'Результат операции различает подготовку, принятый исходник и показанный кадр.',
      ),
    ),
  );
  server.registerTool(
    'story_produce',
    {
      description:
        'Produce HTML, PNG, supported SVG, video, captions or source from an explicit shown build or working revision. Current conditions require a build target with an observed scene context; they apply to HTML and images. Video requires an explicit story or interval. Returns a persistent, inspectable job.',
      inputSchema: {
        target: contextTarget,
        requestId,
        options: z
          .object({
            formats: z
              .array(z.enum(['html', 'png', 'svg', 'mp4', 'source', 'srt', 'vtt']))
              .min(1)
              .default(['html']),
            width: z
              .number()
              .int()
              .min(320)
              .max(3840)
              .describe(
                'Video defaults to 960×540. Give one dimension to derive the other in exact 16:9; output rounds to 32×18 pixel units.',
              )
              .optional(),
            height: z
              .number()
              .int()
              .min(180)
              .max(3840)
              .describe(
                'For video, height is at most 2160; an explicit width/height pair must be 16:9. Images use this as their browser viewport height.',
              )
              .optional(),
            fps: z.number().int().min(1).max(60).optional(),
            theme: z.enum(['light', 'dark']).optional(),
            silent: z
              .boolean()
              .describe(
                'Omit narration from HTML and video without changing the selected source or build.',
              )
              .optional(),
            conditions: z.enum(['authored', 'current']).default('authored'),
            video: z
              .discriminatedUnion('kind', [
                z.strictObject({ kind: z.literal('story') }),
                z
                  .strictObject({
                    kind: z.literal('interval'),
                    from: z.number().finite().nonnegative(),
                    to: z.number().finite().positive(),
                  })
                  .refine((value) => value.to > value.from, 'Video end must follow its start.'),
              ])
              .optional(),
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
        target: contextTarget,
        requestId,
        options: z
          .object({
            cue: z.string().min(1).max(256).optional(),
            from: z.number().finite().nonnegative().optional(),
            at: z
              .number()
              .finite()
              .nonnegative()
              .optional()
              .describe('Center of the temporal overlay, in source seconds.'),
            radius: z
              .number()
              .finite()
              .positive()
              .optional()
              .describe('Fade distance before and after the center, in seconds.'),
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
          .refine(
            (options) => !options.cue || options.at === undefined,
            'Use either a cue or an explicit at time.',
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
        'Read public APIs, existing projects and the complete gpt-model exemplar. For grouping and remainder start with story_create(document), then story_edit(operations) in the same live card. Read StoryDocument, validateStoryDocument or IllustratedStory for its compact contract. For new source-code behavior create a scaffold, edit, review and open it. queries accepts up to 12 public API names; projectId reads the exact pinned runtime before dependency installation.',
      inputSchema: {
        query: z.string().max(300).optional(),
        queries: z.array(z.string().min(1).max(300)).min(1).max(12).optional(),
        context: context.optional(),
        projectId: projectId.optional(),
        group: z.string().max(100).optional(),
        recommended: z.boolean().optional(),
      },
      annotations: read,
    },
    safely(async (args) => {
      const value = await runtime.call(args.query || args.queries ? 'help' : 'catalog', args);
      return result(value, value.text ?? 'Доступные проекты и эталон объяснения.');
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
        'Explicitly upgrade a project to this plugin’s core. Optional changes use the same UTF-8 replacement/deletion contract as story_edit, so removed APIs can be migrated in the same operation. Applies changes to a separate candidate before building; only a successful candidate publishes sources, package and lockfile as one undoable edit. Supply at most 62 source files plus package.json and package-lock.json. A changed source in the supplied context prevents publication. Runtime archives remain available for story_edit undo. The result publishes the verified build directly, without a second compilation. Existing views remain visible during preparation.',
      inputSchema: {
        context,
        requestId,
        changes: fileChanges.optional(),
      },
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
        'Inspect or select narration: default local Higgs TTS 3 BF16, a user-selected local model, or an API connected by the agent. For local/api, provide model and a project-relative .mjs adapter; read skills/visual-explainer/references/voice-adapter.md in the installed plugin. The adapter returns WAV and actual speech timestamps; keep API credentials in the runtime environment, outside project files. Inspection checks adapter configuration without a synthesis/API request. enabled=true saves one undoable edit and prepares synchronized narration through the cancellable JobRunner. Only Higgs prepares MLX dependencies. Enable narration when requested; preserve the selected model when it fails. Toggling preserves settings; playback muting is separate.',
      inputSchema: {
        context: context.optional(),
        requestId: requestId.optional(),
        enabled: z.boolean().optional(),
        provider: z.enum(['higgs', 'local', 'api']).optional(),
        voice: z.string().max(200).optional(),
        language: z.string().max(35).optional(),
        model: z.string().min(1).max(200).optional(),
        adapter: z.string().min(1).max(1000).optional(),
      },
      annotations: changeView,
    },
    safely(async (args) => {
      if (args.enabled !== undefined && (!args.context || !args.requestId))
        throw new Error('Changing narration requires context and requestId.');
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
