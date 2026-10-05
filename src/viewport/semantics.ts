import { Box3, Raycaster, Vector2, Vector3, type Camera, type Object3D, type Mesh } from 'three';
import { describeObject, type ObjectMeaning } from '../scene-objects.js';
import { objectVisible } from './visibility.js';

interface Subject {
  id: string;
  object: Object3D;
  meaning: ObjectMeaning;
}
const subjects = new WeakMap<Object3D, Subject>();

/** Child meshes, inscriptions and outlines inherit the authored subject. */
export function subjectOf(object: Object3D): Subject | undefined {
  for (let node: Object3D | null = object; node; node = node.parent) {
    const subject = subjects.get(node);
    if (subject) return subject;
  }
}

export interface SubjectOptions3D {
  /** World bounds for a logical part drawn by a shared surface such as MathMorph. */
  bounds?(): Box3;
  visible?(): boolean;
}

/** Geometry owns hit testing; common scene selection owns IDs and keyboard actions. */
export function semanticObjects3D(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  scene: Object3D,
  camera: Camera,
  invalidate: () => void,
) {
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const records = new Map<
    string,
    Subject & {
      element: HTMLButtonElement;
      options: SubjectOptions3D;
      dispose(): void;
    }
  >();
  const raycaster = new Raycaster();
  const boxOf = (subject: { object: Object3D; options: SubjectOptions3D }) =>
    subject.options.bounds?.() ?? new Box3().setFromObject(subject.object);
  const attached = (object: Object3D) => {
    for (let node: Object3D | null = object; node; node = node.parent)
      if (node === scene) return true;
    return false;
  };
  const visible = (record: { object: Object3D; options: SubjectOptions3D }) =>
    attached(record.object) && objectVisible(record.object) && record.options.visible?.() !== false;
  const observer = new MutationObserver(invalidate);
  let down: { x: number; y: number; pointer: number } | undefined;
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      down =
        event.button === 0 && event.isPrimary
          ? { x: event.clientX, y: event.clientY, pointer: event.pointerId }
          : undefined;
    },
    listen,
  );
  canvas.addEventListener(
    'pointercancel',
    () => {
      down = undefined;
    },
    listen,
  );
  canvas.addEventListener(
    'pointerup',
    (event) => {
      const click =
        down?.pointer === event.pointerId &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5;
      down = undefined;
      if (!click) return;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      raycaster.setFromCamera(
        new Vector2(
          ((event.clientX - rect.x) / rect.width) * 2 - 1,
          1 - ((event.clientY - rect.y) / rect.height) * 2,
        ),
        camera,
      );
      const hit = raycaster.intersectObjects(scene.children, true).find(({ object }) => {
        const material = (object as Mesh).material;
        return (
          objectVisible(object) &&
          (!material ||
            (Array.isArray(material) ? material.some((m) => m.visible) : material.visible))
        );
      });
      const candidates = [...records.values()]
        .flatMap((record) => {
          if (!record.options.bounds || !visible(record)) return [];
          const point = raycaster.ray.intersectBox(boxOf(record), new Vector3());
          return point ? [{ record, distance: point.distanceTo(raycaster.ray.origin) }] : [];
        })
        .sort((a, b) => a.distance - b.distance);
      // A logical part is more specific than its enclosing operation's bounds.
      const region = candidates.find(
        (candidate) =>
          !candidates.some((other) => {
            if (other === candidate) return false;
            for (let node = other.record.object.parent; node; node = node.parent)
              if (node === candidate.record.object) return true;
            return false;
          }),
      );
      const subject = hit && subjectOf(hit.object);
      const record =
        region && (!hit || subject || region.distance <= hit.distance)
          ? region.record
          : subject && records.get(subject.id);
      if (record && visible(record)) record.element.click();
    },
    listen,
  );

  function render() {
    if (!records.size) return;
    const rect = canvas.getBoundingClientRect(),
      stageRect = stage.getBoundingClientRect();
    for (const record of records.values()) {
      const button = record.element;
      if (button.getAttribute('aria-label') !== record.meaning.label) {
        button.setAttribute('aria-label', record.meaning.label);
        button.firstElementChild!.textContent = record.meaning.label;
      }
      if (!visible(record)) {
        button.hidden = true;
        continue;
      }
      const box = boxOf(record),
        points: Vector3[] = [];
      if (!box.isEmpty())
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z])
              points.push(new Vector3(x, y, z).project(camera));
      if (
        !points.length ||
        points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite)) ||
        points.every((p) => p.z < -1 || p.z > 1)
      ) {
        button.hidden = true;
        continue;
      }
      const left = Math.max(-1, Math.min(...points.map((p) => p.x))),
        right = Math.min(1, Math.max(...points.map((p) => p.x))),
        top = Math.min(1, Math.max(...points.map((p) => p.y))),
        bottom = Math.max(-1, Math.min(...points.map((p) => p.y)));
      button.hidden = right <= left || top <= bottom;
      if (button.hidden) continue;
      button.style.left = `${rect.x - stageRect.x + ((left + 1) * rect.width) / 2}px`;
      button.style.top = `${rect.y - stageRect.y + ((1 - top) * rect.height) / 2}px`;
      button.style.width = `${((right - left) * rect.width) / 2}px`;
      button.style.height = `${((top - bottom) * rect.height) / 2}px`;
      const selected = button.hasAttribute('data-selected'),
        focused = document.activeElement === button;
      button.style.outline =
        selected || focused
          ? `2px ${focused ? 'solid' : 'dashed'} var(--ve-blue, #2670a8)`
          : 'none';
      button.firstElementChild!.toggleAttribute('hidden', !selected && !focused);
    }
  }
  return {
    render,
    ids: () => [...records.keys()],
    describe(object: Object3D, id: string, meaning: ObjectMeaning, options: SubjectOptions3D = {}) {
      if (abort.signal.aborted) throw new Error('3D subjects have been disposed');
      if (records.has(id) || subjects.has(object)) throw new Error(`Duplicate 3D subject: ${id}`);
      const element = document.createElement('button');
      element.type = 'button';
      element.dataset.object = id;
      element.style.cssText =
        'position:absolute;pointer-events:none;background:transparent;border:0;padding:0;min-width:0;min-height:0;border-radius:6px;z-index:2;';
      const label = document.createElement('span');
      label.hidden = true;
      label.textContent = meaning.label;
      label.style.cssText =
        'position:absolute;left:0;bottom:100%;max-width:240px;background:var(--ve-surface, white);color:var(--ve-ink, #17212b);padding:3px 6px;border-radius:4px;font-size:13px;white-space:normal;';
      element.append(label);
      stage.append(element);
      const forget = describeObject(element, meaning);
      element.addEventListener('focus', invalidate, listen);
      element.addEventListener('blur', invalidate, listen);
      observer.observe(element, { attributes: true, attributeFilter: ['data-selected'] });
      const record = {
        id,
        object,
        meaning,
        element,
        options,
        dispose() {
          if (records.get(id) !== record) return;
          records.delete(id);
          subjects.delete(object);
          forget();
          element.remove();
          invalidate();
        },
      };
      records.set(id, record);
      subjects.set(object, record);
      invalidate();
      return record.dispose;
    },
    bounds(ids: readonly string[]) {
      const bounds = new Box3();
      for (const id of ids) {
        const record = records.get(id);
        if (!record || !visible(record)) throw new Error(`Unavailable 3D subject: ${id}`);
        bounds.union(boxOf(record));
      }
      return bounds;
    },
    remove(root: Object3D) {
      for (const record of [...records.values()])
        for (let node: Object3D | null = record.object; node; node = node.parent)
          if (node === root) {
            record.dispose();
            break;
          }
    },
    dispose() {
      abort.abort();
      observer.disconnect();
      for (const record of [...records.values()]) record.dispose();
    },
  };
}
