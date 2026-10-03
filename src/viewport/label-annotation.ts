import { pen } from '../ink/pen.js';

export interface LabelFrame {
  shape?: 'rectangle' | 'ellipse';
  /** Horizontal and vertical breathing room, in CSS pixels. */
  padding?: [number, number];
}
const ns = 'http://www.w3.org/2000/svg';

/** Text and its decoration share one screen-space transform and lifetime. */
export function annotation(stage: HTMLElement, tone: string, frame?: LabelFrame) {
  const group = document.createElement('div');
  group.className = 've-annotation';
  group.style.color = `var(--ve-${tone})`;
  const element = document.createElement('span');
  element.className = 've-label';
  element.dataset.tone = tone;
  group.append(element);
  stage.append(group);
  const border = frame && document.createElementNS(ns, 'svg');
  if (border) {
    border.classList.add('ve-annotation-frame');
    border.setAttribute('aria-hidden', 'true');
    group.prepend(border);
    group.dataset.framed = 'true';
  }
  const ink = border && pen(border);
  let drawing: ReturnType<ReturnType<typeof pen>['rect']> | undefined;
  let dimensions = '';
  function frameSize(width: number, height: number) {
    if (!frame) return [width, height];
    const [px, py] = frame.padding ?? [13, 6];
    const w = width + 2 * px,
      h = height + 2 * py;
    return frame.shape === 'ellipse' ? [Math.max(w, h), Math.max(w, h)] : [w, h];
  }
  return {
    group,
    element,
    frameSize,
    hidden(value: boolean) {
      group.hidden = element.hidden = value;
    },
    place(x: number, y: number, width: number, height: number) {
      group.style.left = `${x}px`;
      group.style.top = `${y}px`;
      group.style.width = `${width}px`;
      group.style.height = `${height}px`;
      const next = `${width.toFixed(2)} ${height.toFixed(2)}`;
      if (!border || !ink || dimensions === next) return;
      dimensions = next;
      border.setAttribute('viewBox', `0 0 ${width} ${height}`);
      drawing?.dispose();
      drawing =
        frame?.shape === 'ellipse'
          ? ink.ellipse(
              border,
              'annotation',
              width / 2,
              height / 2,
              width / 2 - 2,
              height / 2 - 2,
              { width: 1.1 },
            )
          : ink.rect(border, 'annotation', 2, 2, width - 4, height - 4, { width: 1.1 });
    },
    remove() {
      drawing?.dispose();
      group.remove();
    },
  };
}
