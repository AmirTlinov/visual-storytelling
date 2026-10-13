import { z } from 'zod';
const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => Boolean(value.trim()), 'An ID must not be blank.');
const values = z.record(id, z.union([z.number().finite(), z.string().max(4096), z.boolean()]));
const revision = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
export const context = z.string().min(40).max(4096);
export const contextTarget = z.strictObject({ kind: z.enum(['build', 'working']), context });
export const command = z.discriminatedUnion('type', [
  z.strictObject({ type: z.enum(['play', 'pause', 'undoExperiment', 'redoExperiment']) }),
  z.strictObject({ type: z.literal('mute'), value: z.boolean() }),
  z.strictObject({ type: z.literal('rate'), value: z.number().min(0.25).max(3) }),
  z.strictObject({ type: z.literal('seek'), time: z.number().finite().nonnegative() }),
  z.strictObject({ type: z.literal('cue'), id, progress: z.number().min(0).max(1).optional() }),
  z.strictObject({
    type: z.literal('parameters'),
    values: values.refine(
      (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 128,
      'Supply 1–128 parameter values.',
    ),
  }),
  z.strictObject({ type: z.literal('mode'), value: z.enum(['story', 'explore']) }),
  z.strictObject({ type: z.literal('focus'), ids: z.array(id).min(1).max(100) }),
  z.strictObject({ type: z.literal('select'), ids: z.array(id).max(100) }),
  z.strictObject({ type: z.literal('theme'), value: z.enum(['auto', 'light', 'dark', 'inherit']) }),
  z.strictObject({ type: z.literal('reduced'), value: z.boolean() }),
]);
// App performance.now() offsets, in milliseconds, against this timeOrigin.
// Rendered means a frame opportunity, never screenshot/pixel evidence.
const timestamp = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const viewMetrics = z.strictObject({
  timeOrigin: timestamp,
  resourceMountedAt: timestamp,
  inputAt: timestamp.optional(),
  toolResultAt: timestamp.optional(),
  attachStartedAt: timestamp.optional(),
  attachCompletedAt: timestamp.optional(),
  firstReportStartedAt: timestamp.optional(),
  firstPreparedAt: timestamp.optional(),
  firstContentAt: timestamp.optional(),
  confirmedPreparedAt: timestamp.optional(),
  confirmedAt: timestamp.optional(),
});
export const viewReport = z
  .object({
    stateRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    renderStatus: z.enum(['rendered', 'prepared', 'failed']).optional(),
    observationError: z.string().max(4096).optional(),
    metrics: viewMetrics.optional(),
    authoring: z
      .object({
        requestId: id,
        commandId: id,
        buildRevision: revision,
        sourceRevision: revision,
      })
      .optional(),
    state: z.record(z.string(), z.unknown()),
    checkpoint: z
      .object({
        time: z.number().finite().nonnegative(),
        cue: id.optional(),
        chapter: id.optional(),
        chapters: z.array(id).max(1000).optional(),
        progress: z.number().min(0).max(1),
        mode: z.enum(['story', 'explore']),
        muted: z.boolean().optional(),
        rate: z.number().min(0.25).max(3).optional(),
        selected: z.array(id).max(100).optional(),
        values,
        subject: z.unknown().optional(),
        view: z.unknown().optional(),
      })
      .optional(),
    reason: z.string().max(100).optional(),
  })
  .refine(
    (report) => report.checkpoint || report.renderStatus === 'failed',
    'A prepared observation needs its presented checkpoint.',
  );
export const acknowledgement = z.object({
  id,
  result: z.unknown().optional(),
  error: z.string().max(4096).optional(),
  failure: z
    .object({
      code: z.enum(['scene_control_failed', 'scene_control_cancelled']),
      commandIndex: z.number().int().min(0).max(31),
      completedCommands: z.number().int().min(0).max(32),
    })
    .optional(),
});
export const sessionId = z.string().uuid();
export const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const changeView = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
