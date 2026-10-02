export type ControlValue = string | number | boolean;
export interface ControlParameter {
  key?: string;
  label: string;
  type?: 'range' | 'number' | 'stepper' | 'toggle' | 'checkbox' | 'select' | 'choice';
  value: ControlValue;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  format?: (value: ControlValue) => string;
  options?: { value: ControlValue; label: string; color?: string }[];
}

/* One factory owns the fields, their pencil marks and keyboard behavior. */

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean> = {},
  text?: string,
) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
};
let serial = 0;
const inkField = (input: HTMLInputElement) => {
  const wrapper = make('span', { class: 've-field' });
  wrapper.append(input);
  return wrapper;
};
function selectControl(
  p: ControlParameter,
  title: HTMLElement,
  emit: (value: ControlValue) => void,
  listen: AddEventListenerOptions,
) {
  const id = `ve-select-${++serial}`,
    wrapper = make('div', { class: 've-field ve-field-select' });
  const trigger = make('button', {
    type: 'button',
    id,
    class: 've-select-trigger',
    role: 'combobox',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-controls': `${id}-options`,
    'aria-labelledby': `${id}-label`,
    popovertarget: `${id}-options`,
  });
  const menu = make('div', {
    id: `${id}-options`,
    class: 've-select-list',
    role: 'listbox',
    'aria-labelledby': `${id}-label`,
    popover: 'auto',
  });
  const scroll = make('div', { class: 've-select-scroll' });
  menu.append(scroll);
  title.id = `${id}-label`;
  title.setAttribute('for', id);
  const rows = (p.options ?? []).map((option, index) => {
    const row = make('div', {
      id: `${id}-${index}`,
      role: 'option',
      class: 've-select-option',
      'aria-selected': 'false',
    });
    row.append(make('span', {}, option.label));
    scroll.append(row);
    return row;
  });
  let selected = 0,
    active = 0,
    letters = '',
    typedAt = 0;
  const isOpen = () => menu.matches(':popover-open');
  function mark(index: number) {
    active = Math.max(0, Math.min(rows.length - 1, index));
    rows.forEach((row, i) => (row.dataset.active = String(i === active)));
    if (isOpen()) {
      trigger.setAttribute('aria-activedescendant', rows[active]!.id);
      const row = rows[active]!;
      if (row.offsetTop < scroll.scrollTop) scroll.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > scroll.scrollTop + scroll.clientHeight)
        scroll.scrollTop = row.offsetTop + row.offsetHeight - scroll.clientHeight;
    }
  }
  function place() {
    const r = trigger.getBoundingClientRect(),
      viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0,
      top = viewport?.offsetTop || 0,
      w = viewport?.width || innerWidth,
      h = viewport?.height || innerHeight;
    const width = Math.min(r.width, w - 16),
      below = top + h - r.bottom - 12,
      above = r.top - top - 12;
    const up = below < Math.min(180, rows.length * 44 + 20) && above > below;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(44, Math.min(320, up ? above : below))}px`;
    menu.style.left = `${Math.max(left + 8, Math.min(r.left, left + w - width - 8))}px`;
    menu.style.top = `${up ? Math.max(top + 8, r.top - menu.getBoundingClientRect().height - 6) : r.bottom + 6}px`;
  }
  const close = () => {
    if (isOpen()) menu.hidePopover();
  };
  const open = () => {
    if (!trigger.disabled && rows.length && !isOpen()) {
      menu.showPopover();
      place();
      mark(selected);
    }
  };
  const choose = (index: number) => {
    close();
    emit((p.options ?? [])[index]!.value);
  };
  menu.addEventListener(
    'beforetoggle',
    (event) => {
      if (event.newState === 'open') {
        menu.style.visibility = 'hidden';
        letters = '';
        active = selected;
        mark(active);
      }
    },
    listen,
  );
  menu.addEventListener(
    'toggle',
    () => {
      trigger.setAttribute('aria-expanded', String(isOpen()));
      if (isOpen()) {
        place();
        mark(active);
        menu.style.visibility = '';
      } else trigger.removeAttribute('aria-activedescendant');
    },
    listen,
  );
  rows.forEach((row, index) => {
    row.addEventListener('pointerdown', (event) => event.preventDefault(), listen);
    row.addEventListener(
      'pointermove',
      () => {
        if (active !== index) mark(index);
      },
      listen,
    );
    row.addEventListener('click', () => choose(index), listen);
  });
  trigger.addEventListener(
    'keydown',
    (event) => {
      const key = event.key,
        wasOpen = isOpen();
      if (key === 'Tab') {
        if (wasOpen) choose(active);
        return;
      }
      if (key === 'Escape') {
        if (wasOpen) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        return;
      }
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
        event.preventDefault();
        if (key === 'Enter' || key === ' ') {
          if (wasOpen) choose(active);
          else open();
          return;
        }
        open();
        if (key === 'Home') mark(0);
        else if (key === 'End') mark(rows.length - 1);
        else if (wasOpen) mark(active + (key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        open();
        letters = (performance.now() - typedAt < 700 ? letters : '') + key.toLocaleLowerCase();
        typedAt = performance.now();
        const prefix = [...letters].every((letter) => letter === letters[0])
          ? letters[0]!
          : letters;
        const order = Array.from(
          { length: rows.length },
          (_, i) => (active + (prefix.length === 1 ? 1 : 0) + i) % rows.length,
        );
        const match = order.find((i) =>
          (p.options ?? [])[i]!.label.toLocaleLowerCase().startsWith(prefix),
        );
        if (match !== undefined) mark(match);
      }
    },
    listen,
  );
  window.addEventListener(
    'resize',
    () => {
      if (isOpen()) place();
    },
    listen,
  );
  window.addEventListener('blur', close, listen);
  document.addEventListener(
    'scroll',
    (event) => {
      if (isOpen() && !menu.contains(event.target as Node | null)) close();
    },
    { ...listen, capture: true },
  );
  wrapper.append(trigger, menu);
  return {
    element: wrapper,
    setValue(value: ControlValue) {
      selected = Math.max(
        0,
        (p.options ?? []).findIndex((option) => option.value === value),
      );
      trigger.textContent = (p.options ?? [])[selected]?.label || 'Нет вариантов';
      trigger.disabled = Boolean(p.disabled) || !rows.length;
      rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === selected)));
      if (!isOpen()) mark(selected);
    },
  };
}
function field(p: ControlParameter, onChange: (value: ControlValue) => void = () => {}) {
  const type = p.type || 'range',
    abort = new AbortController(),
    listen = { signal: abort.signal };
  const element = make(
    type === 'choice' ? 'fieldset' : ['stepper', 'select'].includes(type) ? 'div' : 'label',
    { class: `ve-control ve-control-${type}` },
  );
  const title = make(
    type === 'choice' ? 'legend' : ['stepper', 'select'].includes(type) ? 'label' : 'span',
    { class: 've-control-title' },
    p.label,
  );
  let value = p.value;
  let inputs: HTMLInputElement[] = [],
    output: HTMLOutputElement | undefined,
    select: ReturnType<typeof selectControl> | undefined;
  element.append(title);
  const emit = (next: ControlValue) => {
    value = next;
    update();
    onChange(next);
  };
  if (type === 'choice') {
    const group = make('span', { class: 've-choices' }),
      name = `ve-choice-${++serial}`;
    for (const option of p.options ?? []) {
      const label = make('label'),
        input = make('input', { type: 'radio', name, value: option.value });
      if (option.color) label.style.color = `var(--ve-${option.color})`;
      input.addEventListener('change', () => emit(option.value), listen);
      label.append(input, make('span', {}, option.label));
      group.append(label);
      inputs.push(input);
    }
    element.append(group);
  } else if (type === 'toggle' || type === 'checkbox') {
    const input = make('input', { type: 'checkbox' });
    inputs = [input];
    if (type === 'toggle') input.setAttribute('role', 'switch');
    element.prepend(input);
    input.addEventListener('change', () => emit(input.checked), listen);
  } else if (type === 'select') {
    select = selectControl(p, title, emit, listen);
    element.append(select.element);
  } else if (type === 'range' || type === 'number' || type === 'stepper') {
    const input = make('input', {
      type: type === 'range' ? 'range' : 'number',
      step: p.step ?? 1,
      'aria-label': p.label,
    });
    inputs = [input];
    for (const key of ['min', 'max'] as const)
      if (p[key] !== undefined) input.setAttribute(key, String(p[key]));
    const changed = () => {
      const valid = Number.isFinite(input.valueAsNumber) && input.validity.valid;
      input.setAttribute('aria-invalid', String(!valid));
      if (valid) emit(input.valueAsNumber);
    };
    input.addEventListener('input', changed, listen);
    input.addEventListener(
      'blur',
      () => {
        update();
        input.removeAttribute('aria-invalid');
      },
      listen,
    );
    if (type === 'range') {
      output = make('output');
      title.append(output);
      element.append(input);
    } else if (type === 'stepper') {
      input.id = `ve-number-${++serial}`;
      title.setAttribute('for', input.id);
      const row = make('span', { class: 've-stepper' });
      const minus = make('button', { type: 'button', 'aria-label': `Уменьшить: ${p.label}` }, '−'),
        plus = make('button', { type: 'button', 'aria-label': `Увеличить: ${p.label}` }, '+');
      minus.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          input.stepDown();
          changed();
        },
        listen,
      );
      plus.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          input.stepUp();
          changed();
        },
        listen,
      );
      row.append(minus, inkField(input), plus);
      element.append(row);
    } else element.append(inkField(input));
  } else throw new Error(`Unknown control type: ${type}`);
  function update() {
    select?.setValue(value);
    for (const input of inputs) {
      if (type === 'choice') input.checked = input.value === String(value);
      else if (type === 'toggle' || type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
      input.disabled = Boolean(p.disabled);
    }
    if (output) output.textContent = p.format ? p.format(value) : Number(value).toFixed(2);
    if (type === 'stepper') {
      const buttons = element.querySelectorAll('button');
      buttons[0]!.disabled = Boolean(p.disabled) || Number(value) <= (p.min ?? -Infinity);
      buttons[1]!.disabled = Boolean(p.disabled) || Number(value) >= (p.max ?? Infinity);
    }
  }
  update();
  return {
    element,
    get value() {
      return value;
    },
    setValue(next: ControlValue) {
      value = next;
      update();
    },
    dispose() {
      abort.abort();
      element.remove();
    },
  };
}
function action(
  label: string,
  onClick: (event: MouseEvent) => void,
  { pressed, disabled = false }: { pressed?: boolean; disabled?: boolean } = {},
) {
  const button = make('button', { type: 'button' }, label);
  button.disabled = disabled;
  if (pressed !== undefined) {
    button.dataset.mode = 'action';
    button.setAttribute('aria-pressed', String(pressed));
  }
  button.addEventListener('click', onClick);
  return button;
}
export const SketchControls = { field, action };
import type { Pigment } from '../ink/palette.js';
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
  const field = SketchControls.field(
    {
      ...options,
      type: 'range',
      format: (value) => options.format?.(Number(value)) ?? String(value),
    },
    (value) => options.onInput(Number(value)),
  );
  const input = field.element.querySelector('input')!;
  return {
    element: field.element,
    input,
    set(value: number) {
      field.setValue(value);
    },
    dispose: field.dispose,
  };
}
export function choice<T extends string>(
  label: string,
  options: readonly { value: T; label: string; pigment?: Pigment }[],
  initial: T,
  onInput: (value: T) => void,
) {
  const field = SketchControls.field(
    {
      label,
      type: 'choice',
      value: initial,
      options: options.map((o) => ({
        value: o.value,
        label: o.label,
        color: o.pigment === 'ochre' ? 'orange' : o.pigment === 'straw' ? 'yellow' : o.pigment,
      })),
    },
    (value) => onInput(value as T),
  );
  return {
    element: field.element,
    set: (value: T) => field.setValue(value as ControlValue),
    dispose: field.dispose,
  };
}
