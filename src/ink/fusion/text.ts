import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { glyphs } from '../glyphs.js';
import {
  handwritingFamily,
  handwritingMetrics,
  handwritingProfiles,
  type Handwriting,
} from '../handwriting.js';
import { fusionShape, type FusionGlyph, type FusionShape, type FusionText } from './shape.js';
import type { InkPoint, InkPath } from './transport.js';

export interface FusionTextOptions {
  size?: number;
  maxWidth?: number;
  lineHeight?: number;
  align?: 'left' | 'center';
  font?: string;
  handwriting?: Handwriting;
}

// Glyph geometry is independent of the word or its position. Reuse it as counters change.
const glyphInk = new Map<string, InkPath[]>();

/** Layout keeps glyph and word ownership; wrapping never shrinks an entire paragraph. */
export function fusionText(value: string, options: FusionTextOptions = {}): FusionShape {
  if (!value.trim()) throw new Error('Fusion text must contain a visible character');
  const {
    size = 100,
    maxWidth = 320,
    lineHeight = 1.35,
    align = 'center',
    handwriting = 'body',
    font = handwritingFamily(handwriting),
  } = options;
  if (
    !(size > 0 && maxWidth > 0 && lineHeight > 0) ||
    !Number.isFinite(size + maxWidth + lineHeight)
  )
    throw new Error('Text dimensions must be positive and finite');
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = `400 ${size}px ${font}`;
  const family = font.split(',')[0]!.trim().replaceAll(/["']/g, ''),
    profile = Object.values(handwritingProfiles).find((hand) => hand.family === family),
    slant = Math.tan(((profile?.slant ?? 0) * Math.PI) / 180);
  const paths: InkPath[] = [],
    letters: FusionGlyph[] = [],
    words: FusionText['words'] = [];
  const lineWidths: number[] = [];
  let x = 0,
    line = 0,
    space = 0;
  const advanceLine = () => {
    lineWidths[line] = x;
    x = 0;
    space = 0;
    line++;
  };
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const tokens = value.replace(/\r\n?/g, '\n').match(/[^\S\n]+|\n|[^\s]+/gu)!;
  for (const token of tokens) {
    if (token === '\n') {
      advanceLine();
      continue;
    }
    if (/^\s+$/u.test(token)) {
      space = context.measureText(token).width;
      continue;
    }
    const word = words.length;
    words.push({ value: token, glyphs: [] });
    const wordWidth = context.measureText(token).width;
    if (x && x + space + wordWidth > maxWidth) advanceLine();
    else if (x) x += space;
    space = 0;
    for (const char of [...segmenter.segment(token)].map((s) => s.segment)) {
      const advance = context.measureText(char).width;
      if (x && x + advance > maxWidth) advanceLine();
      const baseline = line * size * lineHeight;
      const letter: FusionGlyph = {
        value: char,
        word,
        line,
        center: [x + advance / 2, baseline - size * 0.35],
        size,
        paths: [],
      };
      const key = `${font}/${profile?.stroke}/${profile?.slant}/${size}/${advance}/${char}`;
      let local = glyphInk.get(key);
      if (!local) {
        local = [];
        const strokes = profile ? glyphs[char] : undefined;
        if (strokes && profile) {
          const sx = advance / handwritingMetrics.glyphWidth,
            sy =
              (size * handwritingMetrics.capHeight) /
              handwritingMetrics.em /
              handwritingMetrics.baseline,
            shear = sy * slant;
          for (const d of strokes) {
            // Measure each path once. Repeated SVG point queries redo native curve
            // traversal and stall the first frame that needs a new character.
            const path = MotionPathPlugin.cacheRawPathMeasurements(
              MotionPathPlugin.stringToRawPath(d),
              120,
            ) as number[][] & { totalLength: number };
            const length = path.totalLength,
              count = Math.max(2, Math.ceil((length * (Math.max(sx, sy) + Math.abs(shear))) / 1.5));
            local.push(
              Array.from({ length: count }, (_, i): InkPoint => {
                const at = (length * i) / (count - 1),
                  point = MotionPathPlugin.getPositionOnPath(path, at / length);
                const before = MotionPathPlugin.getPositionOnPath(
                    path,
                    Math.max(0, at - 0.01) / length,
                  ),
                  after = MotionPathPlugin.getPositionOnPath(
                    path,
                    Math.min(length, at + 0.01) / length,
                  );
                const tx = (after.x - before.x) * sx - (after.y - before.y) * shear,
                  ty = (after.y - before.y) * sy,
                  norm = Math.hypot(tx, ty) || 1,
                  y = (point.y - handwritingMetrics.baseline) * sy;
                return [
                  advance * handwritingMetrics.inset + point.x * sx - y * slant,
                  y,
                  // Support of the transformed round pen along the screen-space normal.
                  (profile.stroke / 2) *
                    Math.hypot((sx * ty) / norm, (sy * tx + shear * ty) / norm),
                ];
              }),
            );
          }
        } else {
          const box = context.measureText(char),
            w = Math.ceil(box.actualBoundingBoxLeft + box.actualBoundingBoxRight + 12),
            h = Math.ceil(box.actualBoundingBoxAscent + box.actualBoundingBoxDescent + 12);
          const shape = fusionShape(w, h, (ctx) => {
            ctx.font = context.font;
            ctx.fillText(char, 6 + box.actualBoundingBoxLeft, 6 + box.actualBoundingBoxAscent);
          });
          local = shape.paths.map((path) =>
            path.map(
              (p): InkPoint => [
                p[0] + w / 2 - 6 - box.actualBoundingBoxLeft,
                p[1] + h / 2 - 6 - box.actualBoundingBoxAscent,
                p[2],
              ],
            ),
          );
        }
        if (glyphInk.size >= 512) glyphInk.delete(glyphInk.keys().next().value!);
        glyphInk.set(key, local);
      }
      for (const path of local) {
        letter.paths.push(paths.length);
        paths.push(path.map((p): InkPoint => [x + p[0], baseline + p[1], p[2]]));
      }
      words[word]!.glyphs.push(letters.length);
      letters.push(letter);
      x += advance;
    }
  }
  lineWidths[line] = x;
  const blockWidth = Math.max(...lineWidths);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const letter of letters) {
    const shift = align === 'center' ? (blockWidth - lineWidths[letter.line]!) / 2 : 0;
    letter.center = [letter.center[0] + shift, letter.center[1]];
    for (const index of letter.paths) {
      paths[index] = paths[index]!.map((p): InkPoint => {
        const x = p[0] + shift;
        minX = Math.min(minX, x - p[2]);
        maxX = Math.max(maxX, x + p[2]);
        minY = Math.min(minY, p[1] - p[2]);
        maxY = Math.max(maxY, p[1] + p[2]);
        return [x, p[1], p[2]];
      });
    }
  }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  for (const letter of letters) letter.center = [letter.center[0] - cx, letter.center[1] - cy];
  return {
    width: maxX - minX,
    height: maxY - minY,
    bounds: { width: maxX - minX, height: maxY - minY },
    paths: paths.map((path) => path.map((p): InkPoint => [p[0] - cx, p[1] - cy, p[2]])),
    text: { glyphs: letters, words },
  };
}
