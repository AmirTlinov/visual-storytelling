import { svg } from './dom.js';
import { color, type Pigment } from './palette.js';
import { describeObject, type ObjectMeaning } from '../scene-objects.js';

/** Register a subject for selection and review by id. Placement belongs to layout; labels inherit relative motion and pigment. */
export function object(parent: SVGElement, id: string, pigment: Pigment = 'ink') {
  const element = svg('g', { 'data-object': id, color: color(pigment) });
  const motion = svg('g');
  element.append(motion);
  parent.append(element);
  return {
    element,
    content: motion,
    describe(meaning: ObjectMeaning) {
      describeObject(element, meaning);
    },
    at(x: number, y: number, rotate = 0) {
      element.setAttribute('transform', `translate(${x} ${y}) rotate(${rotate})`);
    },
    move(x: number, y: number, rotate = 0) {
      motion.setAttribute('transform', `translate(${x} ${y}) rotate(${rotate})`);
    },
    show(visible: boolean) {
      element.style.display = visible ? '' : 'none';
      element.setAttribute('aria-hidden', String(!visible));
    },
    pigment(value: Pigment) {
      element.setAttribute('color', color(value));
    },
    dispose() {
      element.remove();
    },
  };
}
export type InkObject = ReturnType<typeof object>;
