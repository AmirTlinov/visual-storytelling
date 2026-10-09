import { glyphWidthFactors } from './glyphs.js';

/** One pen specification drives both the animated centerlines and generated font outlines. */
export const handwritingProfiles = {
  body: { family: 'SketchPencil', stroke: 0.8, slant: 2 },
  heading: { family: 'SketchPencilHeading', stroke: 1.16, slant: 8 },
  note: { family: 'SketchPencilNote', stroke: 0.68, slant: 11 },
} as const;

export type Handwriting = keyof typeof handwritingProfiles;

export const handwritingMetrics = {
  em: 1000,
  glyphWidth: 7.8,
  baseline: 10,
  capHeight: 820,
  inset: 0.055,
} as const;

export function handwritingFamily(profile: Handwriting) {
  if (!Object.hasOwn(handwritingProfiles, profile))
    throw new Error('Handwriting must be body, heading or note');
  return `${handwritingProfiles[profile].family},SketchShantell,sans-serif`;
}

/** Numerals have one measured advance and enough space for the complete ink. */
export function handwritingGlyphWidth(character: string) {
  return /^[0-9]$/.test(character)
    ? 8.4
    : handwritingMetrics.glyphWidth * (glyphWidthFactors[character] ?? 1);
}

/** SVG coordinates, before placement: generated outlines and moving ink use this matrix. */
export function handwritingTransform(
  character: string,
  advance: number,
  size: number,
  profile: (typeof handwritingProfiles)[Handwriting],
): readonly [number, number, number, number, number, number] {
  const vertical = (size * handwritingMetrics.capHeight) / handwritingMetrics.em;
  const scale = vertical / handwritingMetrics.baseline;
  const slant = Math.tan((profile.slant * Math.PI) / 180);
  return [
    advance / handwritingGlyphWidth(character),
    0,
    -scale * slant,
    scale,
    advance * handwritingMetrics.inset + vertical * slant,
    -vertical,
  ];
}
