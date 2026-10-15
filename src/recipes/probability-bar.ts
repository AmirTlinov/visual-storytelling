import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Surface } from '../ink/surface.js';
import type { Pigment } from '../ink/palette.js';
import type { ObjectMeaning } from '../scene-objects.js';
/** A probability occupies its actual share of a common [0,1] ruler. Zero has no painted area. */
export function probabilityBar(
  view: Surface,
  id: string,
  probability: number,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    size: number;
    pigment?: Pigment;
    meaning?: ObjectMeaning;
  },
) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1)
    throw new Error('A probability bar needs a value in [0,1].');
  const mark = object(view.layer, id, options.pigment ?? 'green');
  mark.describe(
    options.meaning ?? {
      label: 'Доля вероятности',
      value: () => probability,
      unit: '1',
      interactive: false,
    },
  );
  const background = view.pen.line(
    mark.content,
    `${id}:ruler`,
    [options.x, options.y + options.height / 2],
    [options.x + options.width, options.y + options.height / 2],
    { width: 0.5 },
  );
  const bar = view.pen.rect(
    mark.content,
    `${id}:bar`,
    options.x,
    options.y,
    options.width * probability,
    options.height,
    { fill: 'marker', width: 0.8 },
  );
  bar.element.style.visibility = probability > 0 ? '' : 'hidden';
  const label = lettering(mark.content, `${(100 * probability).toFixed(1)}%`, {
    x: options.x + options.width + options.size * 0.6,
    y: options.y + options.height * 0.8,
    anchor: 'start',
    size: options.size,
  });
  return {
    element: mark.element,
    dispose() {
      label.dispose();
      bar.dispose();
      background.dispose();
      mark.dispose();
    },
  };
}
