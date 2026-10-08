interface PathInk {
  length: number;
  tip: SVGCircleElement;
  signature: string | null;
}
interface TextInk {
  group: SVGGElement;
  strokes: SVGPathElement[];
  weights: number[];
  total: number;
}
import { measureText } from './text-measure.js';
import { glyphs as SketchPencil } from './glyphs.js';
import { SVG_NS as NS, clamp } from './dom.js';
import { handwritingMetrics, handwritingProfiles, type Handwriting } from './handwriting.js';
/* Seekable pen strokes. Scene composition and playback belong to their own owners. */

const paths = new WeakMap<SVGPathElement, PathInk>(),
  lettering = new WeakMap<SVGTextElement, TextInk>();
function geometry(path: SVGPathElement) {
  const signature = path.getAttribute('d');
  if (paths.has(path) && paths.get(path)!.signature !== signature) {
    paths.get(path)!.length = path.getTotalLength();
    paths.get(path)!.signature = signature;
  }
  if (!paths.has(path)) {
    const length = path.getTotalLength(),
      tip = document.createElementNS(NS, 'circle');
    const style = getComputedStyle(path),
      width = parseFloat(style.strokeWidth) || 2;
    tip.setAttribute('r', String(width > 8 ? 0 : Math.max(0.22, width * 0.7)));
    tip.setAttribute('fill', path.style.stroke || path.getAttribute('stroke') || 'currentColor');
    tip.setAttribute('stroke', 'none');
    tip.style.pointerEvents = 'none';
    tip.style.display = 'none';
    path.after(tip);
    paths.set(path, { length, tip, signature });
  }
  return paths.get(path)!;
}
function draw(path: SVGPathElement, amount: number) {
  const { length, tip } = geometry(path),
    p = clamp(amount);
  // A slight acceleration within each stroke avoids a mechanically uniform wipe.
  const ink = p === 0 || p === 1 ? p : p + 0.055 * Math.sin(Math.PI * 2 * p);
  path.style.strokeDasharray = `${length} ${length}`;
  path.style.strokeDashoffset = String(length * (1 - ink));
  path.style.visibility = p === 0 ? 'hidden' : '';
  // A hidden tip must not enlarge getBBox() at its last position (or the origin).
  tip.style.display = p > 0 && p < 1 ? '' : 'none';
  if (p > 0 && p < 1) {
    const point = path.getPointAtLength(length * ink);
    tip.setAttribute('cx', String(point.x));
    tip.setAttribute('cy', String(point.y));
    tip.setAttribute('transform', path.getAttribute('transform') || '');
  }
}
function trace(elements: SVGPathElement[], amount: number) {
  const weights = elements.map((e) => geometry(e).length),
    total = weights.reduce((a, b) => a + b, 0),
    at = clamp(amount) * total;
  let cursor = 0;
  elements.forEach((e, i) => {
    draw(e, weights[i]! > 0 ? (at - cursor) / weights[i]! : Number(at >= cursor));
    cursor += weights[i]!;
  });
}
function textPaint(text: SVGTextElement, group: SVGGElement) {
  const classes = text.getAttribute('class') || '',
    color = text.style.color || text.style.fill || text.getAttribute('fill') || '';
  if (group.getAttribute('class') !== classes) group.setAttribute('class', classes);
  if (group.style.color !== color) group.style.color = color;
}
function prepareText(text: SVGTextElement) {
  if (lettering.has(text)) {
    const cached = lettering.get(text)!;
    cached.group.setAttribute('transform', text.getAttribute('transform') || '');
    textPaint(text, cached.group);
    return cached;
  }
  const group = document.createElementNS(NS, 'g'),
    style = getComputedStyle(text),
    size = parseFloat(style.fontSize),
    name = text.getAttribute('data-handwriting'),
    profile =
      (name && Object.hasOwn(handwritingProfiles, name)
        ? handwritingProfiles[name as Handwriting]
        : undefined) ??
      Object.values(handwritingProfiles).find(({ family }) =>
        style.fontFamily.split(',').some((font) => font.trim().replaceAll(/["']/g, '') === family),
      ) ??
      handwritingProfiles.body,
    verticalScale =
      (size * handwritingMetrics.capHeight) / handwritingMetrics.em / handwritingMetrics.baseline;
  group.setAttribute('aria-hidden', 'true');
  group.setAttribute('data-written-text', text.id);
  group.style.pointerEvents = 'none';
  textPaint(text, group);
  if (text.hasAttribute('transform'))
    group.setAttribute('transform', text.getAttribute('transform')!);
  text.after(group);
  const strokes: SVGPathElement[] = [];
  measureText(text, (measured) =>
    Array.from(text.textContent ?? '').forEach((char, i) => {
      if (/\s/.test(char)) return;
      const glyph = SketchPencil[char];
      if (!glyph)
        throw Error(`No pen strokes for ${char}; add them in src/ink/glyphs.ts or use static text`);
      const advance = measured.getSubStringLength(i, 1),
        position = measured.getStartPositionOfChar(i),
        letter = document.createElementNS(NS, 'g');
      letter.setAttribute(
        'transform',
        `translate(${position.x + advance * handwritingMetrics.inset} ${position.y}) skewX(${-profile.slant}) scale(${advance / handwritingMetrics.glyphWidth} ${verticalScale}) translate(0 ${-handwritingMetrics.baseline})`,
      );
      group.append(letter);
      glyph.forEach((d) => {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', String(profile.stroke));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        letter.append(path);
        strokes.push(path);
      });
    }),
  );
  text.style.fillOpacity = '0';
  // Include small pen-lift intervals between strokes. Their placement is stable.
  const weights = strokes.map((p) => geometry(p).length + 0.9),
    total = weights.reduce((a, b) => a + b, 0);
  const data = { group, strokes, weights, total };
  lettering.set(text, data);
  return data;
}
function write(text: SVGTextElement, amount: number) {
  const { strokes, weights, total } = prepareText(text),
    at = clamp(amount) * total;
  let cursor = 0;
  strokes.forEach((path, i) => {
    draw(path, (at - cursor) / (weights[i]! - 0.9));
    cursor += weights[i]!;
  });
}
function writeSequence(elements: SVGTextElement[], amount: number) {
  const weights = elements.map((e) => prepareText(e).total),
    total = weights.reduce((a, b) => a + b, 0),
    at = clamp(amount) * total;
  let cursor = 0;
  elements.forEach((e, i) => {
    write(e, (at - cursor) / weights[i]!);
    cursor += weights[i]!;
  });
}
function resetText(text: SVGTextElement) {
  const old = lettering.get(text);
  if (old) {
    old.group.remove();
    text.style.removeProperty('fill-opacity');
    lettering.delete(text);
  }
}
export const SketchMotion = {
  draw,
  trace,
  write,
  writeSequence,
  resetText,
};
