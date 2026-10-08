import {
  surface,
  node,
  object,
  lettering,
  paragraph,
  vector,
  svgButton,
  inkButton,
} from '@visual-storytelling/core';
import { bits, bit, binary } from './memory.js';
import { narrative } from './narrative.js';

/** The register owns its geometry; pen, labels and activation keep the shared notebook style. */
export function registerDrawing(host, dispatch, inspect) {
  const view = surface(host, {
    id: 'memory-register',
    width: 800,
    height: 660,
    title: 'Восемь бит памяти',
    description:
      'Входные биты соединены с восемью триггерами. Общий фронт такта записывает байт при WE = 1.',
    grid: false,
  });
  view.element.setAttribute('role', 'group');
  let width = 0,
    state,
    frame,
    mode;
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
  const savedValue = text('В памяти: 0', 25, 'purple');
  const sum = text('00000000₂ = 0', 18);
  const enableNote = text('WE = 0', 17);
  const tickNote = text('CLK = 0', 17);
  const annotations = Object.fromEntries(
    [
      ['input', 'blue'],
      ['memory', 'purple'],
      ['enable', 'orange'],
      ['clock', 'orange'],
    ].map(([name, pigment]) => {
      const mark = object(view.layer, 'narrative-' + name, pigment);
      mark.element.dataset.narrativeNote = name;
      const label = paragraph(mark.content, { size: 18, lineHeight: 1.3 });
      return [name, { mark, label }];
    }),
  );
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
  const transfer = object(view.layer, 'byte-transfer', 'purple');
  const pulses = bits.map((i) =>
    view.pen.line(transfer.content, 'transfer-' + i, [0, 0], [0, 12], { width: 3 }),
  );
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
  function render(next, nextFrame, nextMode) {
    state = next;
    frame = nextFrame;
    mode = nextMode;
    const story = narrative(next, frame, mode);
    const w = Math.max(320, host.clientWidth);
    const step = (w - 32) / 8;
    if (w !== width) {
      width = w;
      view.resize(w, 660, false);
      byte.at(w < 500 ? 95 : 115, 28);
      capacity.at(w - 68, 28);
      inputLabel.at(66, 66);
      inputValue.at(w - 42, 66);
      savedValue.at(w / 2, 611);
      sum.at(w / 2, 645);
      enable.at(w * 0.25, 470);
      tick.at(w * 0.75, 470);
      enableNote.at(w * 0.25, 435);
      tickNote.at(w * 0.75, 435);
      inputs.forEach(({ mark, weight, hit }, j) => {
        const x = 16 + step * (j + 0.5);
        mark.at(x, 177);
        weight.at(x, 146);
        hit.bounds({
          x: -Math.min(step - 2, 50) / 2,
          y: -22,
          width: Math.min(step - 2, 50),
          height: 44,
        });
        cells[j].mark.at(x, 285);
        cells[j].name.at(x + 11, 246);
        arrows[j].set([x, 203], [x, 249]);
        branches[j].update('M' + x + ' 345L' + x + ' 316');
      });
      rail.update('M' + (16 + step / 2) + ' 345H' + (w - 16 - step / 2));
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
      const opacity = story.single && bits[j] !== 5 ? '.25' : '1';
      mark.element.style.opacity = opacity;
      cells[j].mark.element.style.opacity = opacity;
      cells[j].name.element.style.opacity = opacity;
      inputs[j].weight.element.style.opacity = opacity;
      arrows[j].element.style.opacity = story.single ? '.2' : story.focus === 'write' ? '1' : '.5';
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
      'M' + (w * 0.75 + tick.width / 2) + ' 470H' + (w - 6) + 'V345H' + (w - 16 - step / 2),
    );
    timing.pigment(next.event === 'write' ? 'purple' : 'orange');
    const positions = {
      input: [w / 2, 95, w - 36],
      memory: [w / 2, 376, w - 36],
      enable: [w * 0.25, 522, w / 2 - 24],
      clock: [w * 0.75, 522, w / 2 - 24],
    };
    for (const [name, { mark, label }] of Object.entries(annotations)) {
      const fact = story[name];
      mark.show(Boolean(fact));
      if (!fact) continue;
      const [x, y, available] = positions[name];
      label.render(fact.text, available, x, y);
      label.write(fact.cue && !frame.reduced ? Math.min(1, frame.elapsed(fact.cue) / 0.8) : 1);
      mark.element.dataset.cue = fact.cue ?? '';
      mark.element.setAttribute('aria-label', fact.text);
      if (fact.cue) {
        frame.target(fact.cue, 'narrative-' + name);
        const targets =
          name === 'input'
            ? bits.map((i) => 'input-' + i)
            : name === 'memory'
              ? bits.map((i) => 'saved-' + i)
              : [name === 'enable' ? 'write-enable' : 'clock'];
        targets.forEach((id) => frame.target(fact.cue, id));
      }
    }
    // The same short emphasis crosses all eight connections together. State is atomic.
    const elapsed = frame.elapsed('write_42');
    const flowing = mode === 'story' && frame.has('write_42') && elapsed < 0.7 && !frame.reduced;
    transfer.show(flowing);
    if (flowing)
      pulses.forEach((line, j) => {
        const x = 16 + step * (j + 0.5),
          y = 204 + (31 * elapsed) / 0.7;
        line.update('M' + x + ' ' + y + 'v12');
      });
    view.element.dataset.focus = story.focus;
  }
  const observer = new ResizeObserver(() => state && render(state, frame, mode));
  observer.observe(host);
  return {
    render,
    dispose() {
      observer.disconnect();
      controls.forEach((c) => c.dispose());
      notes.forEach((n) => n.dispose());
      Object.values(annotations).forEach(({ label }) => label.dispose());
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
