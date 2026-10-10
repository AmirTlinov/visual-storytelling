import { pen } from '../ink/pen.js';
import type { LabelBox } from '../layout/labels.js';

export interface LabelFrame {
  shape?: 'rectangle' | 'ellipse';
  /** Horizontal and vertical breathing room, in CSS pixels. */
  padding?: [number, number];
}
const ns = 'http://www.w3.org/2000/svg';
let serial = 0;

/** Text and its decoration share one screen-space transform and lifetime. */
export function annotation(stage: HTMLElement, tone: string, frame?: LabelFrame, mask?: string) {
  const group = document.createElement('div');
  group.id = `ve-annotation-${++serial}`;
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
  let leader: SVGSVGElement | undefined;
  let trail: ReturnType<ReturnType<typeof pen>['polyline']> | undefined;
  let connected = false;
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
      if (leader) leader.style.display = value || !connected ? 'none' : '';
    },
    opacity(value: number) {
      group.style.opacity = String(value);
      if (leader) leader.style.opacity = String(value);
    },
    place(x: number, y: number, width: number, height: number, anchor?: readonly [number, number]) {
      group.style.left = `${x}px`;
      group.style.top = `${y}px`;
      group.style.width = `${width}px`;
      group.style.height = `${height}px`;
      const dx = anchor ? anchor[0] - x : 0,
        dy = anchor ? anchor[1] - y : 0,
        ratio = Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2));
      connected = !!anchor && ratio > 1;
      if (anchor && connected) {
        if (!leader) {
          leader = document.createElementNS(ns, 'svg');
          leader.classList.add('ve-annotation-leader');
          leader.dataset.annotation = group.id;
          leader.setAttribute('aria-hidden', 'true');
          if (mask) leader.setAttribute('mask', `url(#${mask})`);
          leader.style.cssText =
            'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
          leader.style.color = `var(--ve-${tone})`;
          // Every connector sits behind all annotations, including earlier ones.
          stage.insertBefore(leader, stage.querySelector('.ve-annotation'));
        }
        leader.style.display = '';
        leader.setAttribute('viewBox', `0 0 ${stage.clientWidth} ${stage.clientHeight}`);
        const distance = Math.hypot(dx, dy),
          end: [number, number] = [
            x + dx / ratio + (dx / distance) * 3,
            y + dy / ratio + (dy / distance) * 3,
          ];
        const points = [anchor, end] as const;
        if (trail) trail.update(points);
        else trail = pen(leader).polyline(leader, 'label-anchor', points, { width: 1.1 });
      } else if (leader) leader.style.display = 'none';
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
      trail?.dispose();
      leader?.remove();
      group.remove();
    },
  };
}

/** Leaders stay behind writing, including physical inscriptions projected from the scene. */
export function annotationMask(stage: HTMLElement) {
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
  const definitions = document.createElementNS(ns, 'defs'),
    mask = document.createElementNS(ns, 'mask'),
    base = document.createElementNS(ns, 'rect');
  mask.id = `ve-label-clearance-${++serial}`;
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
  base.setAttribute('fill', 'white');
  mask.append(base);
  definitions.append(mask);
  svg.append(definitions);
  stage.append(svg);
  const cutouts: SVGRectElement[] = [];
  return {
    id: mask.id,
    update(boxes: readonly LabelBox[], width: number, height: number) {
      for (const node of [mask, base]) {
        node.setAttribute('x', '0');
        node.setAttribute('y', '0');
        node.setAttribute('width', String(width));
        node.setAttribute('height', String(height));
      }
      while (cutouts.length > boxes.length) cutouts.pop()!.remove();
      boxes.forEach((box, index) => {
        let rect = cutouts[index];
        if (!rect) {
          rect = document.createElementNS(ns, 'rect');
          rect.setAttribute('fill', 'black');
          cutouts.push(rect);
          mask.append(rect);
        }
        rect.setAttribute('x', String(box.x - 2));
        rect.setAttribute('y', String(box.y - 2));
        rect.setAttribute('width', String(box.width + 4));
        rect.setAttribute('height', String(box.height + 4));
      });
    },
    dispose() {
      svg.remove();
    },
  };
}
