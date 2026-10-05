import { z } from 'zod';
const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => Boolean(value.trim()), 'An ID must not be blank.');
const values = z.record(id, z.union([z.number().finite(), z.string().max(4096), z.boolean()]));
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
export const viewReport = z.object({
  stateRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  state: z.record(z.string(), z.unknown()),
  checkpoint: z.object({
    time: z.number().finite().nonnegative(),
    cue: id.optional(),
    progress: z.number().min(0).max(1),
    mode: z.enum(['story', 'explore']),
    muted: z.boolean().optional(),
    rate: z.number().min(0.25).max(3).optional(),
    selected: z.array(id).max(100).optional(),
    values,
    view: z.unknown().optional(),
  }),
  reason: z.string().max(100).optional(),
});
export const acknowledgement = z.object({
  id,
  result: z.unknown().optional(),
  error: z.string().max(4096).optional(),
});
export const sessionId = z.string().uuid();
export const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const changeView = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
