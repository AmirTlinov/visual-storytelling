import { svg } from '../ink/dom.js';
import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { pen } from '../ink/pen.js';
import { svgButton } from '../controls/svg.js';
import { svgInteractionContour } from '../controls/svg-contour.js';
import { vector } from './vector.js';
import { rationalNumber } from '../math/rational.js';
import type { LeverModelState } from './lever-model.js';
import type { Surface } from '../ink/surface.js';
import type { DrawingViewport } from '../story/subject.js';
import type { LeverSide, LeverGrip } from './lever-interaction.js';

const number = (value: number) => Number(value.toFixed(2)).toLocaleString('ru-RU');
export interface LeverCalibration {
  maxForce: number;
  maxArm: number;
}
/** Persistent ink. Playback changes transforms and the clock, never rebuilds the bar or its text. */
export function leverArtwork(
  view: Surface,
  viewport: DrawingViewport,
  modelId: string,
  viewId: string,
  initial: LeverModelState,
  calibration: LeverCalibration,
  maximumArm: number,
) {
  let state = initial;
  const { width, height, scale } = viewport.layout;
  const canvas = svg('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    visibility: 'hidden',
  });
  view.layer.append(canvas);
  const root = object(canvas, viewId),
    ink = pen(canvas),
    cleanups: Array<() => void> = [() => canvas.remove(), root.dispose];
  const font = Math.max(16, Math.min(24, (width * scale) / 25)) / scale;
  const cx = width / 2,
    cy = height * 0.4,
    span = width * 0.38;
  const compact = width * scale < 620;
  const armScale = span / calibration.maxArm;
  const drawing = { ...view, element: canvas, layer: root.content, pen: ink };
  const grips = new Map<LeverSide, LeverGrip>();
  const loads: Array<{
    side: LeverSide;
    mark: ReturnType<typeof object>;
    tag: SVGGElement;
    attachment: ReturnType<Surface['pen']['path']>;
    arrow: ReturnType<typeof vector>;
    label: ReturnType<typeof lettering>;
    forceLabel: ReturnType<typeof lettering>;
    controlLabel?: ReturnType<typeof lettering>;
    hit?: SVGRectElement;
    buttons: Array<{ direction: number; button: ReturnType<typeof svgButton> }>;
  }> = [];
  function label(parent: SVGElement, value: string, x: number, y: number, size = font) {
    const item = lettering(parent, value, { x, y, size, anchor: 'middle' });
    cleanups.push(item.dispose);
    if (item.width > width * 0.95) throw new Error('Lever text needs one short readable line.');
    return item;
  }
  let angle = 0;
  try {
    const rod = object(root.content, `${modelId}:rod`);
    const bar = ink.path(rod.content, `${modelId}:bar`, `M${-span} -5 H${span} V5 H${-span} Z`, {
      width: 1.5 / scale,
      fill: 'marker',
    });
    cleanups.push(rod.dispose, bar.dispose);
    for (let cm = -Math.floor(calibration.maxArm / 10) * 10; cm <= calibration.maxArm; cm += 10) {
      const x = cm * armScale;
      const tick = ink.line(
        rod.content,
        `${modelId}:tick:${cm}`,
        [x, -5],
        [x, cm % 50 === 0 ? 8 : 3],
        { width: 0.8 / scale },
      );
      cleanups.push(tick.dispose);
    }
    const pivot = object(root.content, `${modelId}:pivot`);
    pivot.describe({
      label: 'Неподвижная ось',
      value: () => 'Вращение вокруг оси без трения',
      interactive: false,
    });
    const stand = ink.path(
      pivot.content,
      `${modelId}:stand`,
      `M${cx} ${cy} l${-22 / scale} ${30 / scale} h${44 / scale} Z`,
      { width: 1.2 / scale, fill: 'marker' },
    );
    cleanups.push(pivot.dispose, stand.dispose);
    const stopY = cy + span * Math.sin(Math.PI / 10) + 5;
    for (const sign of [-1, 1]) {
      const x = cx + sign * span * Math.cos(Math.PI / 10);
      const stop = ink.path(
        root.content,
        `${modelId}:stop:${sign}`,
        `M${x - 10 / scale} ${stopY} h${20 / scale} M${x} ${stopY} v${12 / scale}`,
        { width: 1 / scale },
      );
      cleanups.push(stop.dispose);
    }
    for (const side of ['left', 'right'] as const) {
      const load = state[side],
        pigment = side === 'left' ? 'blue' : 'green';
      const mark = object(root.content, `${modelId}:${side}`, pigment);
      mark.describe({
        label: `${side === 'left' ? 'Левый' : 'Правый'} груз`,
        value: () => state[side].moment,
        unit: 'Н·м',
        inputs: () => [`${modelId}:${side}Force`, `${modelId}:${side}Arm`],
        provenance: () => ({ force: state[side].force, distanceFromAxis: state[side].arm }),
        interactive: Boolean(viewport.input),
      });
      cleanups.push(mark.dispose);
      const tag = svg('g');
      mark.content.append(tag);
      const attachment = ink.path(mark.content, `${modelId}:${side}:attachment`, 'M0 0L0 -4', {
        width: 1 / scale,
      });
      const point = ink.path(
        mark.content,
        `${modelId}:${side}:point`,
        `M${-3 / scale} 0 a${3 / scale} ${3 / scale} 0 1 0 ${6 / scale} 0 a${3 / scale} ${3 / scale} 0 1 0 ${-6 / scale} 0 Z`,
        { fill: 'marker', width: 1 / scale },
      );
      cleanups.push(attachment.dispose, point.dispose);
      const weight = ink.rect(
        tag,
        `${modelId}:${side}:weight`,
        -29 / scale,
        -56 / scale,
        58 / scale,
        52 / scale,
        { width: 1.2 / scale, fill: 'marker' },
      );
      cleanups.push(weight.dispose);
      const forceLabel = label(tag, '', 0, -33 / scale, Math.min(font, 20 / scale));
      const force = object(root.content, `${modelId}:${side}Force`, pigment);
      force.describe({
        label: 'Сила тяжести вниз',
        value: () => state[side].force,
        unit: 'Н',
        interactive: false,
      });
      const arrow = vector(
        { ...drawing, layer: force.content },
        `${modelId}:${side}:force-arrow`,
        pigment,
        1.2 / scale,
      );
      cleanups.push(force.dispose, arrow.dispose);
      const arm = object(rod.content, `${modelId}:${side}Arm`, pigment);
      arm.describe({
        label: 'Расстояние от оси вдоль перекладины',
        value: () => rationalNumber(state[side].arm) * 100,
        unit: 'см',
        interactive: Boolean(viewport.input),
      });
      const armLabel = label(tag, '', 0, -12 / scale, Math.min(font * 0.875, 16 / scale));
      cleanups.push(arm.dispose);
      let hit: SVGRectElement | undefined, controlLabel: ReturnType<typeof lettering> | undefined;
      const buttons: Array<{ direction: number; button: ReturnType<typeof svgButton> }> = [];
      if (viewport.input) {
        hit = svg('rect', {
          x: -32 / scale,
          y: -60 / scale,
          width: 64 / scale,
          height: 64 / scale,
          fill: 'transparent',
          role: 'slider',
          tabindex: 0,
          'aria-label': `${side === 'left' ? 'Левый' : 'Правый'} груз: расстояние от оси`,
          'aria-valuemin': 0,
          'aria-valuemax': maximumArm,
          'aria-valuenow': rationalNumber(load.arm) * 100,
          'aria-valuetext': `${number(rationalNumber(load.arm) * 100)} сантиметров`,
          'data-lever-grip': side,
        });
        hit.style.cssText = 'cursor:ew-resize;touch-action:none';
        hit.classList.add('ve-svg-button');
        tag.append(hit);
        const contour = svgInteractionContour(hit, `${modelId}:${side}:grip`);
        contour.update({ x: -32 / scale, y: -60 / scale, width: 64 / scale, height: 64 / scale });
        cleanups.push(contour.dispose);
        canvas.setAttribute('role', 'group');
        grips.set(side, {
          side,
          maximum: maximumArm,
          get arm() {
            return rationalNumber(state[side].arm) * 100;
          },
          element: hit,
          project() {
            const matrix = canvas.getScreenCTM();
            const inverse = matrix?.inverse(),
              cosine = Math.cos(angle);
            return (clientX, clientY) => {
              if (!inverse) return 0;
              const point = new DOMPoint(clientX, clientY).matrixTransform(inverse);
              return ((side === 'left' ? -1 : 1) * (point.x - cx)) / (armScale * cosine);
            };
          },
        });
        const forceX = width * (side === 'left' ? 0.25 : 0.75),
          buttonY = height * 0.73;
        for (const direction of [-1, 1]) {
          const x = forceX + (direction * (compact ? 40 : 46)) / scale;
          const buttonInk = ink.rect(
            mark.element,
            `${modelId}:${side}:force:${direction}`,
            x - 20 / scale,
            buttonY - 22 / scale,
            40 / scale,
            40 / scale,
            { width: 1 / scale },
          );
          // Controls remain outside the moving mark's coordinate frame.
          root.content.append(buttonInk.element);
          label(root.content, direction < 0 ? '−' : '+', x, buttonY + 6 / scale);
          const value = rationalNumber(load.force);
          const button = svgButton(root.content, {
            x: x - 22 / scale,
            y: buttonY - 24 / scale,
            width: 44 / scale,
            height: 44 / scale,
            label: `${side === 'left' ? 'Слева' : 'Справа'}: ${direction < 0 ? 'уменьшить' : 'увеличить'} силу на 1 Н`,
            disabled: direction < 0 ? value === 0 : value === 100,
            onPress() {
              viewport.input!({ [`${side}Force`]: rationalNumber(state[side].force) + direction });
              viewport.playback?.replay();
            },
          });
          cleanups.push(buttonInk.dispose, button.dispose);
          buttons.push({ direction, button });
        }
        controlLabel = label(
          root.content,
          '',
          forceX,
          buttonY + 6 / scale,
          compact ? Math.max(14 / scale, font * 0.75) : font,
        );
      }
      loads.push({
        side,
        mark,
        tag,
        attachment,
        arrow,
        label: armLabel,
        forceLabel,
        controlLabel,
        hit,
        buttons,
      });
    }
    const combined = vector(drawing, `${modelId}:combinedForce`, 'ink', 1.2 / scale);
    combined.describe({
      label: 'Сумма весов, приложенных к оси',
      value: () => state.requiredVerticalReaction,
      unit: 'Н',
      interactive: false,
    });
    cleanups.push(combined.dispose);
    const moment = object(root.content, `${modelId}:moment`);
    moment.describe({
      label: 'Суммарный момент при горизонтальной перекладине',
      value: () => state.netMoment,
      unit: 'Н·м',
      interactive: false,
    });
    cleanups.push(moment.dispose);
    const momentLabel = label(
      moment.content,
      '',
      cx,
      height * 0.88,
      Math.max(14 / scale, font * 0.85),
    );
    const clock = label(
      root.content,
      '',
      cx,
      Math.max(18 / scale, font),
      Math.max(14 / scale, font * 0.85),
    );
    const turn = object(root.content, `${modelId}:turn`, 'orange');
    const turning = ink.path(
      turn.content,
      `${modelId}:turning`,
      `M40 -14 Q0 -70 -40 -14 M-39 -29 L-40 -14 L-25 -17`,
      { width: 1.5 / scale },
    );
    turn.describe({
      label: 'Направление начального вращения',
      value: () => state.direction,
      interactive: false,
    });
    turn.at(cx, cy - 45 / scale);
    cleanups.push(turn.dispose, turning.dispose);
    const hint = label(root.content, '', cx, height * 0.98, Math.max(14 / scale, font * 0.82));
    return {
      canvas,
      grips,
      render(next: LeverModelState, text?: string) {
        state = next;
        if (
          Math.max(rationalNumber(state.left.arm), rationalNumber(state.right.arm)) * 100 >
          calibration.maxArm
        )
          throw new Error('Lever distance exceeds the shared drawing calibration.');
        const { motion, time } = state;
        angle = motion.angle;
        rod.at(cx, cy, (-angle * 180) / Math.PI);
        turn.show(!state.equilibrium && time === 0);
        turn.content.setAttribute(
          'transform',
          `scale(${state.direction === 'right-down' ? -1 : 1} 1)`,
        );
        const coincident = state.left.arm.numerator === 0 && state.right.arm.numerator === 0;
        const sum = rationalNumber(state.requiredVerticalReaction);
        // Both comparison viewports reserve the same budget before looking at either pose.
        const arrowSpace = Math.min(height * 0.08, 32 / scale);
        const forceScale =
          arrowSpace /
          Math.max(
            calibration.maxForce,
            rationalNumber(state.left.force),
            rationalNumber(state.right.force),
            coincident ? sum : 0,
          );
        for (const load of loads) {
          const arm = rationalNumber(state[load.side].arm) * 100,
            force = rationalNumber(state[load.side].force);
          const distance = arm * armScale;
          const x = cx + (load.side === 'left' ? -1 : 1) * distance * Math.cos(angle);
          const y = cy + (load.side === 'left' ? 1 : -1) * distance * Math.sin(angle);
          load.mark.at(x, y);
          const tagX =
            load.side === 'left'
              ? Math.min(0, cx - 36 / scale - x)
              : Math.max(0, cx + 36 / scale - x);
          load.tag.setAttribute('transform', `translate(${tagX} 0)`);
          load.attachment.update(`M0 0 L${tagX} ${-4 / scale}`);
          const length = rationalNumber(state[load.side].force) * forceScale;
          load.arrow.set([x, y + 8 / scale], [x, y + 8 / scale + length]);
          if (coincident) load.arrow.show(false);
          load.label.text(`${number(arm)} см`);
          load.forceLabel.text(`${number(force)} Н`);
          load.controlLabel?.text(`${number(force)} Н`);
          load.hit?.setAttribute('aria-valuenow', String(arm));
          load.hit?.setAttribute('aria-valuetext', `${number(arm)} сантиметров`);
          for (const { direction, button } of load.buttons)
            button.update({ disabled: direction < 0 ? force === 0 : force === 100 });
        }
        combined.set([cx, cy + 8 / scale], [cx, cy + 8 / scale + sum * forceScale]);
        if (!coincident) combined.show(false);
        momentLabel.text(
          `Старт: ${number(rationalNumber(state.left.force))} × ${number(rationalNumber(state.left.arm) * 100)} − ${number(rationalNumber(state.right.force))} × ${number(rationalNumber(state.right.arm) * 100)} = ${number(rationalNumber(state.netMoment) * 100)} Н·см`,
        );
        hint.text(
          text ??
            (viewport.input
              ? viewport.playback?.available
                ? 'Тяни груз и отпусти; −/+ меняет его вес.'
                : 'Сдвинь груз: показан результат через2с.'
              : 'Оба груза закреплены.'),
        );
        if (hint.width > width * 0.95) throw new Error('Lever text needs one short readable line.');
        clock.text(
          time === 0
            ? 'Удерживаем горизонтально.'
            : `${number(Math.round(time * 10) / 10)} с${motion.status === 'stop' ? ' · упор' : motion.status === 'balanced' ? ' · равновесие' : ''}`,
        );
        return motion;
      },
      dispose() {
        for (const cleanup of cleanups.reverse()) cleanup();
      },
    };
  } catch (error) {
    for (const cleanup of cleanups.reverse()) cleanup();
    throw error;
  }
}
