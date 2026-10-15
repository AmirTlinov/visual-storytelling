import { releaseResources } from '../lifecycle.js';

/** One concealed validation drawing can become the next rendered frame without rebuilding it. */
export function drawingCandidate<T extends { canvas: SVGSVGElement; dispose(): void }>() {
  let pending: { key: string; value: T; parent: Node } | undefined;
  const clear = () => {
    const previous = pending;
    pending = undefined;
    previous?.value.dispose();
  };
  return {
    check(key: string, prepare: () => T, validate?: (value: T) => void) {
      let next = pending;
      if (!next || next.key !== key) {
        const value = prepare();
        const parent = value.canvas.parentNode;
        if (!parent) {
          value.dispose();
          throw new Error('A validation drawing needs its measurement parent.');
        }
        value.canvas.setAttribute('data-presentation-pending', '');
        value.canvas.remove();
        const previous = pending;
        next = pending = { key, value, parent };
        previous?.value.dispose();
      }
      next.parent.appendChild(next.value.canvas);
      try {
        validate?.(next.value);
      } catch (error) {
        releaseResources(
          [
            () => {
              throw error;
            },
            clear,
          ],
          'Drawing validation failed.',
        );
      } finally {
        next.value.canvas.remove();
      }
    },
    take(key: string): T | undefined {
      const previous = pending;
      pending = undefined;
      if (!previous) return;
      if (previous.key !== key) {
        previous.value.dispose();
        return;
      }
      previous.parent.appendChild(previous.value.canvas);
      previous.value.canvas.removeAttribute('data-presentation-pending');
      return previous.value;
    },
    dispose: clear,
  };
}
