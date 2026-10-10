import { containingSource, sourceAt, sourceOf, type SourceSpan } from './scene-source.js';

export interface ObjectMeaning {
  label: string;
  value?: () => unknown;
  unit?: string;
  source?: SourceSpan;
  implementation?: { file: string };
  inputs?: () => readonly string[];
  provenance?: () => unknown;
}
const meanings = new WeakMap<Element, { meaning: ObjectMeaning }>();

/** Meaning belongs to the rendered object. Geometry and labels keep its existing stable ID. */
export function describeObject(element: Element, meaning: ObjectMeaning) {
  if (!element.getAttribute('data-object')?.trim() || !meaning.label.trim())
    throw new Error('A scene object needs a stable ID and a meaningful label');
  const registration = { meaning };
  meanings.set(element, registration);
  sourceAt(element, sourceOf(meaning) ?? containingSource(element.parentElement));
  element.setAttribute('aria-label', meaning.label);
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  return () => {
    if (meanings.get(element) !== registration) return;
    meanings.delete(element);
    sourceAt(element, undefined);
  };
}

export function sceneObjects(root: Element) {
  const abort = new AbortController();
  const controls =
    'button, input, select, textarea, label, summary, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [tabindex]:not(canvas, svg, [role="img"])';
  let selected: string[] = [];
  const highlighted = new Set<HTMLElement | SVGElement>();
  const nodes = () => {
    if (abort.signal.aborted) throw new Error('Scene objects have been disposed.');
    return [...root.querySelectorAll<HTMLElement | SVGElement>('[data-object]')].filter((node) =>
      meanings.has(node),
    );
  };
  const objects = () => {
    const representations = new Map<string, (HTMLElement | SVGElement)[]>();
    for (const node of nodes()) {
      const id = node.dataset.object!;
      if (!representations.has(id)) representations.set(id, []);
      representations.get(id)!.push(node);
    }
    return [...representations].map(([id, elements]) => {
      const node = elements[0]!;
      const meaning = meanings.get(node)!.meaning;
      return {
        id,
        label: meaning.label,
        value: meaning.value?.(),
        unit: meaning.unit,
        source: meaning.source ?? sourceOf(node),
        implementation: meaning.implementation,
        inputs: meaning.inputs?.(),
        provenance: meaning.provenance?.(),
        visible: elements.some((node) => !node.closest('[aria-hidden="true"]') && isRendered(node)),
      };
    });
  };
  const refreshSelection = (elements = nodes()) => {
    const representatives = new Map<string, HTMLElement | SVGElement>();
    const priority = (node: Element) =>
      node.classList.contains('ve-viewport-object')
        ? 2
        : node.getAttribute('tabindex') === '0'
          ? 1
          : 0;
    for (const node of elements) {
      const active = selected.includes(node.dataset.object!);
      node.toggleAttribute('data-selected', active);
      if (node.getAttribute('aria-pressed') !== String(active))
        node.setAttribute('aria-pressed', String(active));
      if (!active || node.closest('[aria-hidden="true"]') || !isRendered(node)) continue;
      const bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const previous = representatives.get(node.dataset.object!);
      if (!previous || priority(node) > priority(previous))
        representatives.set(node.dataset.object!, node);
    }
    const next = new Set(representatives.values());
    for (const node of highlighted)
      if (!next.has(node)) node.removeAttribute('data-selection-highlight');
    highlighted.clear();
    for (const node of next) {
      node.toggleAttribute('data-selection-highlight', true);
      highlighted.add(node);
    }
  };
  const observer = new MutationObserver(() => {
    if (selected.length && !abort.signal.aborted) refreshSelection();
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-object', 'hidden', 'style', 'class', 'aria-hidden', 'tabindex'],
  });
  const select = (ids: readonly string[]) => {
    const elements = nodes(),
      known = new Set(elements.map((node) => node.dataset.object!));
    if (ids.some((id) => !known.has(id)))
      throw new Error('Unknown scene object. Inspect available objects.');
    selected = [...new Set(ids)];
    refreshSelection(elements);
    root.dispatchEvent(new CustomEvent('scene-selection', { bubbles: true }));
  };
  const target = (event: Event) => {
    // An embedded control owns its activation, even inside a described object.
    const node = (event.target as Element)?.closest?.(`[data-object], ${controls}`);
    return node && root.contains(node) && meanings.has(node)
      ? (node as HTMLElement | SVGElement)
      : null;
  };
  const activate = (node: HTMLElement | SVGElement) => {
    const id = node.dataset.object!;
    select(selected.length === 1 && selected[0] === id ? [] : [id]);
  };
  let down: { x: number; y: number; pointer: number } | undefined;
  root.addEventListener(
    'pointerdown',
    (event) => {
      const e = event as PointerEvent;
      down =
        !e.defaultPrevented && e.button === 0 && e.isPrimary
          ? { x: e.clientX, y: e.clientY, pointer: e.pointerId }
          : undefined;
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'pointerup',
    (event) => {
      const e = event as PointerEvent,
        node = target(e);
      // A renderer consumes a geometry hit before this bubbling event arrives.
      if (
        !e.defaultPrevented &&
        down?.pointer === e.pointerId &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5
      ) {
        if (node) activate(node);
        else if (!(e.target as Element)?.closest?.(controls)) select([]);
      }
      down = undefined;
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'pointercancel',
    () => {
      down = undefined;
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const node = target(event);
      // Native keyboard activation and a renderer's hit-test enter the same owner.
      if (!event.defaultPrevented && node && (event as MouseEvent).detail === 0) activate(node);
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      const e = event as KeyboardEvent,
        node = target(e);
      if (e.defaultPrevented) return;
      if (node && !node.matches('button') && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        activate(node);
      } else if (e.key === 'Escape' && selected.length) select([]);
    },
    { signal: abort.signal },
  );
  return {
    objects,
    select,
    get selected() {
      const known = new Set(nodes().map((node) => node.dataset.object!));
      return selected.filter((id) => known.has(id));
    },
    dispose() {
      if (abort.signal.aborted) return;
      observer.disconnect();
      for (const node of highlighted) node.removeAttribute('data-selection-highlight');
      highlighted.clear();
      for (const node of nodes()) {
        node.removeAttribute('data-selected');
        node.setAttribute('aria-pressed', 'false');
      }
      selected = [];
      down = undefined;
      abort.abort();
    },
  };
}
import { isRendered } from './scene-frame.js';
