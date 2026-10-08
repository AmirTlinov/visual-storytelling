/* Build-time SVG parts. Native HTML owns slider behavior; range.css owns its ink. */
export function svgRange({
  id,
  x,
  y,
  width = 340,
  min = 0,
  max = 1,
  step = 0.02,
  value = 0,
  label,
}: {
  id: string;
  x: number;
  y: number;
  width?: number;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  label: string;
}) {
  const escape = (s: string | number) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
  return `<g id="${escape(id)}"><foreignObject data-native-control="" x="${x}" y="${y}" width="${width}" height="52"><div xmlns="http://www.w3.org/1999/xhtml" style="padding:calc(4 * var(--ve-control-unit,1px)) calc(8 * var(--ve-control-unit,1px))"><input id="${escape(id)}-input" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${escape(label)}"/></div></foreignObject></g>`;
}

// Keep touch targets and pen widths in screen pixels when the SVG viewBox scales.
export function fitSvgControls(root: SVGSVGElement) {
  const width = root.getBoundingClientRect().width;
  if (!width) return;
  const unit = root.viewBox.baseVal.width / width;
  root.style.setProperty('--ve-control-unit', unit + 'px');
  for (const field of root.querySelectorAll('[data-native-control]'))
    field.setAttribute('height', String(52 * unit));
}

export interface SvgButtonBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgButtonState {
  label?: string;
  pressed?: boolean;
  disabled?: boolean;
}

/** A transparent activation region; the subject's ink remains its visible appearance. */
export function svgButton(
  parent: SVGElement,
  options: SvgButtonBounds & SvgButtonState & { label: string; onPress: () => void },
) {
  const element = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect'),
    abort = new AbortController();
  element.classList.add('ve-svg-button');
  element.setAttribute('fill', 'transparent');
  element.setAttribute('role', 'button');
  let disabled = false,
    spaceDown = false,
    enterDown = false,
    pointer: number | undefined,
    pointerInside = false;
  const attribute = (name: string, value: string | number | boolean) => {
    const text = String(value);
    if (element.getAttribute(name) !== text) element.setAttribute(name, text);
  };
  const pressing = () =>
    attribute('data-pressing', !disabled && (spaceDown || enterDown || pointerInside));
  const cancel = () => {
    spaceDown = enterDown = pointerInside = false;
    pointer = undefined;
    pressing();
  };
  const bounds = (value: SvgButtonBounds) => {
    if (abort.signal.aborted) return;
    for (const name of ['x', 'y', 'width', 'height'] as const) attribute(name, value[name]);
  };
  const update = (value: SvgButtonState) => {
    if (abort.signal.aborted) return;
    if (value.label !== undefined) attribute('aria-label', value.label);
    if (value.pressed !== undefined) attribute('aria-pressed', value.pressed);
    if (value.disabled !== undefined) disabled = value.disabled;
    attribute('aria-disabled', disabled);
    attribute('tabindex', disabled ? '-1' : '0');
    if (disabled) cancel();
  };
  const press = () => {
    if (!disabled && !abort.signal.aborted) options.onPress();
  };
  element.addEventListener('click', press, { signal: abort.signal });
  element.addEventListener(
    'pointerdown',
    (event) => {
      if (disabled || !event.isPrimary || event.button !== 0) return;
      pointer = event.pointerId;
      pointerInside = true;
      pressing();
    },
    { signal: abort.signal },
  );
  for (const type of ['pointerenter', 'pointerleave'] as const)
    element.addEventListener(
      type,
      (event) => {
        if (event.pointerId !== pointer) return;
        pointerInside = type === 'pointerenter';
        pressing();
      },
      { signal: abort.signal },
    );
  for (const type of ['pointerup', 'pointercancel'] as const)
    parent.ownerDocument.addEventListener(
      type,
      (event) => {
        if (event.pointerId !== pointer) return;
        pointer = undefined;
        pointerInside = false;
        pressing();
      },
      { capture: true, signal: abort.signal },
    );
  element.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (event.repeat || disabled) return;
      if (event.key === 'Enter') {
        enterDown = true;
        pressing();
        press();
      } else {
        spaceDown = true;
        pressing();
      }
    },
    { signal: abort.signal },
  );
  element.addEventListener(
    'keyup',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const activate = event.key === ' ' && spaceDown;
      if (event.key === 'Enter') enterDown = false;
      else spaceDown = false;
      pressing();
      if (activate) press();
    },
    { signal: abort.signal },
  );
  element.addEventListener('blur', cancel, { signal: abort.signal });
  parent.ownerDocument.defaultView?.addEventListener('blur', cancel, { signal: abort.signal });
  bounds(options);
  update(options);
  parent.append(element);
  return {
    element,
    update,
    bounds,
    dispose() {
      cancel();
      abort.abort();
      element.remove();
    },
  };
}
