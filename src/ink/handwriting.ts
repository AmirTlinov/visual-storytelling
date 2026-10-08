/** One pen specification drives both the animated centerlines and generated font outlines. */
export const handwritingProfiles = {
  body: { family: 'SketchPencil', stroke: 0.8, slant: 3 },
  heading: { family: 'SketchPencilHeading', stroke: 1.08, slant: 7 },
  note: { family: 'SketchPencilNote', stroke: 0.76, slant: 8 },
} as const;

export type Handwriting = keyof typeof handwritingProfiles;

export const handwritingMetrics = {
  em: 1000,
  glyphWidth: 6.7,
  baseline: 10,
  capHeight: 820,
  inset: 0.055,
} as const;

export function handwritingFamily(profile: Handwriting) {
  if (!Object.hasOwn(handwritingProfiles, profile))
    throw new Error('Handwriting must be body, heading or note');
  return `${handwritingProfiles[profile].family},SketchShantell,sans-serif`;
}
