import { html } from '../ink/dom.js';
import { button } from './button.js';
import { color, type Pigment } from '../ink/palette.js';

export interface RangeOptions {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format?: (value: number) => string;
  onInput(value: number): void;
}
export function range(options: RangeOptions) {
  if (
    !Number.isFinite(options.min) ||
    !Number.isFinite(options.max) ||
    options.max <= options.min ||
    (options.step !== undefined && options.step <= 0)
  )
    throw new Error('Invalid parameter range');
  const element = html('label', 'vs-field');
  const heading = html('span', 'vs-field-heading');
  const output = html('output');
  heading.append(html('span', undefined, options.label), output);
  const input = html('input', 'vs-range');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step ?? 1);
  input.setAttribute('aria-label', options.label);
  const format = options.format ?? ((value) => String(value));
  const set = (value: number) => {
    input.value = String(value);
    output.value = format(input.valueAsNumber);
    input.setAttribute('aria-valuetext', output.value);
  };
  const change = () => {
    set(input.valueAsNumber);
    options.onInput(input.valueAsNumber);
  };
  input.addEventListener('input', change);
  set(options.value);
  element.append(heading, input);
  return {
    element,
    input,
    set,
    dispose() {
      input.removeEventListener('input', change);
      element.remove();
    },
  };
}

export function choice<T extends string>(
  label: string,
  options: readonly { value: T; label: string; pigment?: Pigment }[],
  initial: T,
  onInput: (value: T) => void,
) {
  const element = html('div', 'vs-choice');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', label);
  const buttons = options.map((option) => {
    const control = button(option.label, () => {
      set(option.value);
      onInput(option.value);
    });
    element.append(control.element);
    return { value: option.value, pigment: option.pigment, control };
  });
  function set(value: T) {
    for (const entry of buttons) {
      const selected = entry.value === value;
      entry.control.pressed(selected);
      entry.control.element.style.color = selected && entry.pigment ? color(entry.pigment) : '';
    }
  }
  set(initial);
  return {
    element,
    set,
    dispose() {
      for (const entry of buttons) entry.control.dispose();
      element.remove();
    },
  };
}
