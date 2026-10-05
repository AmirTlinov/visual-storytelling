export interface ObjectMeaning {
  label: string;
  value?: () => unknown;
  unit?: string;
  source?: { file: string };
  inputs?: () => readonly string[];
}
const meanings = new WeakMap<Element, ObjectMeaning>();

/** Meaning belongs to the rendered object. Geometry and labels keep its existing stable ID. */
export function describeObject(element: Element, meaning: ObjectMeaning) {
  meanings.set(element, meaning);
  element.setAttribute('aria-label', meaning.label);
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  return () => meanings.delete(element);
}

export function sceneObjects(root: Element) {
  const abort = new AbortController();
  let selected: string[] = [];
  const nodes = () => {
    if (abort.signal.aborted) throw new Error('Scene objects have been disposed.');
    return [...root.querySelectorAll<HTMLElement | SVGElement>('[data-object]')].filter((node) =>
      meanings.has(node),
    );
  };
  const objects = () =>
    nodes().map((node) => {
      const meaning = meanings.get(node)!;
      return {
        id: node.dataset.object!,
        label: meaning.label,
        value: meaning.value?.(),
        unit: meaning.unit,
        source: meaning.source,
        inputs: meaning.inputs?.(),
        visible: !node.closest('[aria-hidden="true"]') && isRendered(node),
      };
    });
  const select = (ids: readonly string[]) => {
    const elements = nodes(),
      known = new Set(elements.map((node) => node.dataset.object!));
    if (ids.some((id) => !known.has(id)))
      throw new Error('Unknown scene object. Inspect available objects.');
    selected = [...new Set(ids)];
    for (const node of elements) {
      const active = selected.includes(node.dataset.object!);
      node.toggleAttribute('data-selected', active);
      node.setAttribute('aria-pressed', String(active));
    }
    root.dispatchEvent(new CustomEvent('scene-selection', { bubbles: true }));
  };
  const target = (event: Event) => {
    const node = (event.target as Element)?.closest?.('[data-object]');
    return node && root.contains(node) && meanings.has(node)
      ? (node as HTMLElement | SVGElement)
      : null;
  };
  let down: { x: number; y: number; pointer: number } | undefined;
  root.addEventListener(
    'pointerdown',
    (event) => {
      const e = event as PointerEvent;
      down =
        e.button === 0 && e.isPrimary
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
      if (
        node &&
        down?.pointer === e.pointerId &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5
      )
        select([node.dataset.object!]);
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
    'keydown',
    (event) => {
      const e = event as KeyboardEvent,
        node = target(e);
      if (node && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        select([node.dataset.object!]);
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
