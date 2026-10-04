import { volumeField } from '../viewport/morph/field.js';
import { fieldSection } from '../viewport/morph/section.js';
import type { Surface } from '../ink/surface.js';
import { svg } from '../ink/dom.js';
import { surfaceInscriptions } from './ink.js';
import type { MorphFrame } from './objects.js';
import { fusionSurface } from '../ink/fusion/surface.js';
import { registerRaster } from '../export/raster.js';

/** A section of the same body and the same moving strokes, clipped by that body's silhouette. */
export function morphBody2D(sheet: Surface, options: { pigment?: string } = {}) {
  const shapes = svg('g', { color: `var(--ve-${options.pigment ?? 'blue'})` });
  const clipId = `${sheet.element.id}-morph-clip`;
  const clip = svg('clipPath', { id: clipId }),
    outline = svg('path');
  clip.append(outline);
  const ink = svg('foreignObject', {
    x: 0,
    y: 0,
    'clip-path': `url(#${clipId})`,
    'data-morph-ink': '',
  });
  const host = document.createElement('div');
  host.style.cssText = 'width:100%;height:100%;pointer-events:none';
  ink.append(host);
  sheet.layer.append(shapes, clip, ink);
  const pen = fusionSurface(host);
  const unregister = registerRaster(ink, () => pen.snapshot());
  const inscriptions = surfaceInscriptions();
  let field: ReturnType<typeof volumeField>,
    topology = '';
  let strokes: Array<ReturnType<Surface['pen']['contour']>> = [];
  return {
    render(frame: MorphFrame, x: number, y: number, scale: number) {
      const next = JSON.stringify(
        [frame.sources, frame.targets].map((parts) => parts.map((p) => p.shape)),
      );
      if (next !== topology) {
        field = volumeField(
          frame.sources.map((p) => p.shape),
          frame.targets.map((p) => p.shape),
        );
        topology = next;
      }
      field.update(frame);
      const contours = fieldSection(field).map((contour) =>
        contour.map(([px, py]) => [x + px * scale, y - py * scale] as const),
      );
      const data = contours.map(
        (contour) => contour.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join('') + 'Z',
      );
      while (strokes.length > data.length) strokes.pop()!.dispose();
      contours.forEach((contour, i) => {
        if (!strokes[i])
          strokes[i] = sheet.pen.contour(shapes, `morph-body-${i}`, contour, {
            fill: 'marker',
            stroke: 'ink',
          });
        else strokes[i]!.update(contour);
      });
      outline.setAttribute('d', data.join(''));
      const width = sheet.element.viewBox.baseVal.width,
        height = sheet.element.viewBox.baseVal.height;
      ink.setAttribute('width', String(width));
      ink.setAttribute('height', String(height));
      const actualWidth = host.getBoundingClientRect().width;
      const sampled = inscriptions.sample(
        frame,
        width / Math.max(1, actualWidth) / scale,
        field.registration,
      );
      pen.renderField(sampled, {
        width: width / scale,
        height: height / scale,
        origin: [(width / 2 - x) / scale, (height / 2 - y) / scale],
      });
      sheet.element.querySelector('desc')!.textContent = sampled.label;
    },
    dispose() {
      strokes.forEach((stroke) => stroke.dispose());
      unregister();
      pen.dispose();
      shapes.remove();
      clip.remove();
      ink.remove();
    },
  };
}
