import { z } from 'zod';

const jsonObject = z.record(z.string(), z.json());
const id = z.string().min(1);
const beat = z.strictObject({
  id,
  text: z.string().describe('Short visible narrative caption in the drawing.').optional(),
  title: z.string().optional(),
  say: z.string().describe('Optional spoken wording; it does not prepare a voice.').optional(),
  speech: jsonObject.optional(),
  action: z
    .string()
    .describe('Meaning of the action for staging; not a visible caption.')
    .optional(),
  hold: z.string().optional(),
  seconds: z.number().finite().positive().optional(),
  timing: jsonObject.optional(),
  operation: z.strictObject({ model: id, name: id }).optional(),
  focus: z.array(id).optional(),
  awaitInput: z.strictObject({ model: id }).optional(),
  actors: jsonObject.optional(),
  props: jsonObject.optional(),
  perform: z.array(z.json()).optional(),
  shot: jsonObject.optional(),
});
const chapters = z.array(
  z.strictObject({
    id,
    title: z.string(),
    beats: z.array(beat).min(1),
    views: z.array(id).optional(),
  }),
);

// Transport exposes command shape. The project's pinned core still owns model,
// references, timing, staging and speech validation; module-specific JSON stays intact.
export const documentOperations = z
  .array(
    z.discriminatedUnion('op', [
      z.strictObject({ op: z.literal('set-inputs'), modelId: id, values: jsonObject }),
      z.strictObject({ op: z.literal('set-resources'), resources: z.array(jsonObject) }),
      z.strictObject({ op: z.literal('set-views'), views: z.array(jsonObject) }),
      z.strictObject({ op: z.literal('set-chapters'), chapters }),
    ]),
  )
  .min(1)
  .max(64);
