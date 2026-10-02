import type { Frame } from '@visual-storytelling/core';
import narration from './narration.json';
export type RemainderCue = keyof typeof narration.cues;
export const productCues = [
  'product_groups',
  'product_sign',
  'product_size',
  'product_equals',
  'product_value',
] as const;
export const summaryCues = [
  'summary_whole',
  'summary_equals',
  'summary_grouped',
  'summary_plus',
  'summary_remainder',
] as const;
export function remainderAt(frame: Frame<RemainderCue>) {
  const cue = narration.cues.group_action,
    duration = cue.end - cue.start;
  return {
    time: frame.time,
    objects: frame.reveal('object_count'),
    progress: frame.progress('group_action'),
    groups: Array.from({ length: 8 }, (_, i) =>
      frame.reduced
        ? Number(frame.time >= cue.start)
        : Math.min(
            1,
            Math.max(0, (frame.time - cue.start - (duration * 0.4 * i) / 7) / (duration * 0.6)),
          ),
    ),
    first: frame.between('each_group', 'group_count'),
    groupSize: frame.reveal('group_size'),
    groupCount: frame.reveal('group_count'),
    product: productCues.map(frame.reveal),
    productVisible: frame.has('product_groups') && !frame.has('summary'),
    remainder: frame.reveal('remainder_value'),
    missing: frame.has('missing_slot') && !frame.has('summary'),
    summary: summaryCues.map(frame.reveal),
  };
}
export type RemainderState = ReturnType<typeof remainderAt>;
