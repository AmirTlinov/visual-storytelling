import { object } from '../ink/object.js';
import type { Pigment } from '../ink/palette.js';
import type { Surface } from '../ink/surface.js';
import { node } from '../recipes/node.js';
import { svgButton, type SvgButtonState } from './svg.js';

export interface InkButtonOptions extends SvgButtonState {
  label: string;
  onPress: () => void;
  width?: number;
  height?: number;
  size?: number;
  pigment?: Pigment;
}

/** A drawn key uses the shared node's ink, with a lower edge visible before interaction. */
export function inkButton(view: Surface, id: string, initial: string, options: InkButtonOptions) {
  const key = object(view.layer, id, options.pigment ?? 'ink');
  key.element.classList.add('ve-ink-button');
  const face = node(view, `${id}:face`, initial, {
    parent: key.content,
    shape: 'rect',
    width: options.width ?? 120,
    height: options.height ?? 44,
    size: options.size ?? 24,
    padding: 8,
    pigment: options.pigment ?? 'ink',
  });
  face.element.classList.add('ve-ink-button-face');
  const edgePath = () => {
    const x = face.width / 2,
      y = face.height / 2;
    return `M${-x} ${y}L${-x + 2} ${y + 4}H${x - 2}L${x} ${y}`;
  };
  const edge = view.pen.path(key.content, `${id}:edge`, edgePath(), { width: 1.65 });
  edge.element.classList.add('ve-ink-button-edge');
  key.content.insertBefore(edge.element, face.element);
  const focusPath = () => {
    const x = face.width * 0.25,
      y = face.height / 2 + 10;
    return `M${-x} ${y}Q0 ${y + 1.5} ${x} ${y - 0.5}`;
  };
  const focus = view.pen.path(key.content, `${id}:focus`, focusPath(), { width: 1.3 });
  focus.element.classList.add('ve-ink-button-focus');
  const bounds = () => ({
    x: -face.width / 2 - 3,
    y: -face.height / 2 - 3,
    width: face.width + 6,
    height: face.height + 10,
  });
  const control = svgButton(key.content, { ...options, ...bounds() });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unregister();
    control.dispose();
    focus.dispose();
    edge.dispose();
    face.dispose();
    key.dispose();
  };
  const unregister = view.onDispose(dispose);
  return {
    element: key.element,
    control: control.element,
    at: key.at,
    text(value: string) {
      if (disposed) return;
      face.text(value);
      edge.update(edgePath());
      focus.update(focusPath());
      control.bounds(bounds());
    },
    update: control.update,
    get width() {
      return face.width;
    },
    get height() {
      return face.height;
    },
    dispose,
  };
}
