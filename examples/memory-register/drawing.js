import {
  surface,
  node,
  object,
  lettering,
  vector,
  svgButton,
  inkButton,
} from '@visual-storytelling/core';
import { bits, bit, binary } from './memory.js';

/** The register owns its geometry; pen, labels and activation keep the shared notebook style. */
export function registerDrawing(host, dispatch, inspect) {
  const view = surface(host, {
    id: 'memory-register',
    width: 800,
    height: 530,
    title: 'Восемь бит памяти',
    description:
      'Входные биты соединены с восемью триггерами. Общий фронт такта записывает байт при WE = 1.',
    grid: false,
  });
  view.element.setAttribute('role', 'group');
  let width = 0,
    state;
  const ink = object(view.layer, 'register-ink', 'ink');
  const text = (value, size = 18, pigment = 'ink') => {
    const mark = object(ink.content, 'note-' + notes.length, pigment);
    const label = lettering(mark.content, value, { size });
    notes.push(label);
    return { ...mark, label };
  };
  const notes = [];
  const byte = text('8 бит = 1 байт', 23);
  const capacity = text('числа 0–255', 17);
  const inputLabel = text('Вход D', 23, 'blue');
  const inputValue = text('0', 27, 'blue');
  const hint = text('нажимай на биты', 16);
  const savedValue = text('В памяти: 0', 25, 'purple');
  const sum = text('00000000₂ = 0', 18);
  const clockNote = text('один такт для всех восьми ячеек', 15);
  const enableNote = text('WE = 0', 17);
  const tickNote = text('CLK = 0', 17);
  const controls = [];
  const inputs = bits.map((i) => {
    const mark = node(view, 'input-' + i, 0, {
      shape: 'rect',
      width: 30,
      height: 38,
      size: 25,
      minSize: 23,
      padding: 3,
      pigment: 'blue',
    });
    const hit = svgButton(mark.content, {
      label: 'Входной бит ' + i,
      onPress: () => dispatch({ type: 'bit', index: i }),
      x: -17,
      y: -22,
      width: 34,
      height: 44,
    });
    hit.element.dataset.bit = i;
    controls.push(hit);
    return { mark, hit, weight: text(2 ** i, 14) };
  });
  const cells = bits.map((i) => {
    const mark = node(view, 'saved-' + i, 0, {
      shape: 'rect',
      width: 30,
      height: 62,
      size: 26,
      minSize: 23,
      padding: 3,
      pigment: 'purple',
    });
    const hit = svgButton(mark.content, {
      label: 'Рассмотреть бит ' + i,
      onPress: () => inspect(i),
      x: -17,
      y: -33,
      width: 34,
      height: 66,
    });
    hit.element.dataset.select = i;
    controls.push(hit);
    const terminal = view.pen.path(mark.content, 'clock-port-' + i, 'M-5 31L0 24L5 31', {
      width: 1.4,
    });
    const name = text('Q' + i, 13);
    return { mark, hit, terminal, name };
  });
  const arrows = bits.map((i) => vector(view, 'data-wire-' + i, 'blue', 1.5));
  const timing = object(view.layer, 'common-clock', 'orange');
  const rail = view.pen.line(timing.content, 'clock-rail', [24, 342], [776, 342], { width: 1.7 });
  const feed = view.pen.path(timing.content, 'clock-feed', 'M600 417H790V342', { width: 1.5 });
  const branches = bits.map((i) =>
    view.pen.line(timing.content, 'clock-wire-' + i, [0, 342], [0, 285], { width: 1.4 }),
  );
  const enable = inkButton(view, 'write-enable', 'Запись: выкл', {
    label: 'Разрешение записи',
    onPress: () => dispatch({ type: 'enable' }),
    width: 122,
    height: 44,
    size: 20,
    pigment: 'orange',
  });
  const tick = inkButton(view, 'clock', 'Дать фронт ↑', {
    label: 'Дать фронт такта',
    onPress: () => dispatch({ type: 'clock' }),
    width: 122,
    height: 44,
    size: 20,
    pigment: 'orange',
  });
  enable.control.id = 'enable';
  tick.control.id = 'clock';
  controls.push(enable, tick);
  function render(next) {
    state = next;
    const w = Math.max(320, host.clientWidth);
    const step = (w - 32) / 8;
    if (w !== width) {
      width = w;
      view.resize(w, 530, false);
      byte.at(w < 500 ? 95 : 115, 34);
      capacity.at(w - 68, 34);
      inputLabel.at(66, 81);
      inputValue.at(w - 42, 81);
      hint.at(w / 2, 59);
      savedValue.at(w / 2, 470);
      sum.at(w / 2, 508);
      clockNote.at(w / 2, 368);
      enable.at(w * 0.25, 417);
      tick.at(w * 0.75, 417);
      enableNote.at(w * 0.25, 386);
      tickNote.at(w * 0.75, 386);
      inputs.forEach(({ mark, weight, hit }, j) => {
        const x = 16 + step * (j + 0.5);
        mark.at(x, 139);
        weight.at(x, 111);
        hit.bounds({
          x: -Math.min(step - 2, 50) / 2,
          y: -22,
          width: Math.min(step - 2, 50),
          height: 44,
        });
        cells[j].mark.at(x, 267);
        cells[j].name.at(x + 11, 214);
        arrows[j].set([x, 165], [x, 231]);
        arrows[j].element.style.opacity = '.65';
        branches[j].update('M' + x + ' 342L' + x + ' 298');
      });
      rail.update('M' + (16 + step / 2) + ' 342H' + (w - 16 - step / 2));
    }
    inputs.forEach(({ mark, hit }, j) => {
      const value = bit(next.input, bits[j]);
      mark.value(value);
      mark.pigment(value ? 'blue' : 'ink');
      hit.update({
        label: 'Входной бит ' + bits[j] + ': ' + value,
        pressed: Boolean(value),
        disabled: Boolean(next.challenge),
      });
      cells[j].mark.value(bit(next.saved, bits[j]));
      cells[j].mark.pigment(bit(next.saved, bits[j]) ? 'purple' : 'ink');
      cells[j].hit.update({
        label: 'Рассмотреть бит ' + bits[j] + ': ' + bit(next.saved, bits[j]),
        pressed: bits[j] === next.selected,
      });
      arrows[j].pigment(next.event === 'write' ? 'purple' : 'blue');
    });
    inputValue.label.text(next.input);
    savedValue.label.text('В памяти: ' + next.saved);
    sum.label.text(binary(next.saved) + '₂ = ' + next.saved);
    enable.text(next.we ? 'Запись: вкл' : 'Запись: выкл');
    tick.text(next.clock ? 'Вернуть в 0 ↓' : 'Дать фронт ↑');
    enable.update({ pressed: next.we, disabled: Boolean(next.challenge) });
    tick.update({
      label: next.clock ? 'Вернуть такт в ноль' : 'Дать фронт такта',
      disabled: Boolean(next.challenge),
    });
    enableNote.label.text('WE = ' + Number(next.we));
    tickNote.label.text('CLK = ' + Number(next.clock));
    feed.update(
      'M' + (w * 0.75 + tick.width / 2) + ' 417H' + (w - 6) + 'V342H' + (w - 16 - step / 2),
    );
    timing.pigment(next.event === 'write' ? 'purple' : 'orange');
  }
  const observer = new ResizeObserver(() => state && render(state));
  observer.observe(host);
  return {
    render,
    dispose() {
      observer.disconnect();
      controls.forEach((c) => c.dispose());
      notes.forEach((n) => n.dispose());
      view.dispose();
    },
  };
}

export function feedbackDrawing(host) {
  const view = surface(host, {
    id: 'bit-feedback',
    width: 480,
    height: 180,
    grid: false,
    title: 'Два инвертора удерживают бит',
    description:
      'Первое НЕ меняет бит, второе возвращает исходное значение. Обратная связь замыкает путь.',
  });
  const loop = object(view.layer, 'feedback', 'purple');
  view.pen.path(loop.content, 'return', 'M62 58H132M190 58H276M334 58H421V145H62V58', {
    width: 1.7,
  });
  for (const [i, x] of [132, 276].entries()) {
    view.pen.path(view.layer, 'inverter-' + i, 'M' + x + ' 30L' + (x + 44) + ' 58L' + x + ' 86Z', {
      width: 1.7,
    });
    view.pen.ellipse(view.layer, 'inversion-' + i, x + 51, 58, 6, 6, { width: 1.6 });
    lettering(view.layer, 'НЕ', { x: x + 16, y: 64, size: 14 });
  }
  const labels = [62, 232, 421].map((x) => lettering(loop.content, 0, { x, y: 38, size: 27 }));
  lettering(loop.content, 'обратная связь', { x: 242, y: 134, size: 20 });
  return {
    render(q) {
      labels[0].text(q);
      labels[1].text(1 - q);
      labels[2].text(q);
    },
    dispose() {
      view.dispose();
    },
  };
}
