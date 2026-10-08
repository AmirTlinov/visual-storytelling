import {
  surface,
  node,
  object,
  lettering,
  paragraph,
  vector,
  svgButton,
  inkButton,
  SketchInk,
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
    height = 0,
    state,
    frame,
    mode;
  const ink = object(view.layer, 'register-ink', 'ink');
  const text = (value, size = 18, pigment = 'ink', handwriting = 'body') => {
    const mark = object(ink.content, 'note-' + notes.length, pigment);
    const label = lettering(mark.content, value, { size, handwriting });
    notes.push(label);
    return { ...mark, label };
  };
  const notes = [];
  const byte = text('8 бит = 1 байт', 27, 'blue', 'heading');
  const capacity = text('числа 0–255', 20, 'ink', 'note');
  const inputLabel = text('Вход D', 23, 'blue', 'note');
  const inputValue = text('0', 36, 'blue', 'heading');
  const savedLabel = text('В памяти', 23, 'blue', 'note');
  const savedValue = text('0', 64, 'blue', 'heading');
  const sum = text('0000 0000₂', 24, 'ink', 'note');
  for (const mark of [capacity, sum]) mark.element.classList.add('memory-secondary');
  const highlight = object(view.layer, 'memory-result-highlight');
  highlight.content.innerHTML =
    SketchInk.markerDefs('memory-result') +
    SketchInk.markerMarkup({
      x: -50,
      y: -28,
      width: 100,
      height: 32,
      seed: 23,
      prefix: 'memory-result',
      color: 'var(--ve-highlight)',
    });
  view.layer.insertBefore(highlight.element, ink.element);
  const group = object(view.layer, 'byte-brace', 'blue');
  const brace = view.pen.path(group.content, 'eight-cells', 'M0 0H1', { width: 1.9 });
  const enableNote = text('WE = 0', 20);
  const tickNote = text('CLK = 0', 20);
  const annotations = Object.fromEntries(
    [
      ['input', 'blue'],
      ['memory', 'blue'],
      ['enable', 'red'],
      ['clock', 'red'],
    ].map(([name, pigment]) => {
      const mark = object(view.layer, 'narrative-' + name, pigment);
      mark.element.dataset.narrativeNote = name;
      const label = paragraph(mark.content, {
        size: name === 'input' || name === 'memory' ? 22 : 20,
        lineHeight: 1.3,
        handwriting: 'note',
      });
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
    const weight = text(2 ** i, 18);
    weight.element.classList.add('memory-secondary');
    return { mark, hit, weight };
  });
  const cells = bits.map((i) => {
    const mark = node(view, 'saved-' + i, 0, {
      shape: 'rect',
      width: 30,
      height: 62,
      size: 26,
      minSize: 23,
      padding: 3,
      pigment: 'blue',
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
    const name = text('Q' + i, 15);
    name.element.classList.add('memory-secondary');
    return { mark, hit, terminal, name };
  });
  const arrows = bits.map((i) => vector(view, 'data-wire-' + i, 'blue', 1.5));
  const transfer = object(view.layer, 'byte-transfer', 'blue');
  const pulses = bits.map((i) =>
    view.pen.line(transfer.content, 'transfer-' + i, [0, 0], [0, 12], { width: 3 }),
  );
  const timing = object(view.layer, 'common-clock', 'red');
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
    pigment: 'red',
  });
  const tick = inkButton(view, 'clock', 'Дать фронт ↑', {
    label: 'Дать фронт такта',
    onPress: () => dispatch({ type: 'clock' }),
    width: 122,
    height: 44,
    size: 20,
    pigment: 'red',
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
    const wide = host.closest('[data-frame-layout]')?.dataset.frameLayout !== 'responsive';
    const h = wide ? Math.max(420, host.clientHeight) : height || 715;
    const diagram = wide ? w * 0.68 : w;
    const aside = diagram + (w - diagram) / 2;
    const step = (diagram - 32) / 8;
    let controlY = wide ? h - 100 : 510;
    if (!wide && story.memory) {
      const label = annotations.memory.label;
      label.render(story.memory.text, w - 36, w / 2, 408);
      controlY = Math.max(controlY, 408 + label.bounds.y + label.bounds.height + 70);
    }
    const inputY = wide ? 150 : 195,
      savedY = wide ? 230 : 285,
      railY = wide ? 284 : 345;
    if (w !== width || h !== height) {
      width = w;
      height = h;
      view.resize(w, h, false);
      byte.at(wide ? 130 : 94, 28);
      byte.content.setAttribute('transform', `scale(${wide ? 1 : 0.8})`);
      capacity.at(diagram - (wide ? 100 : 69), 28);
      inputLabel.at(wide ? 76 : 66, 62);
      inputValue.at(diagram - (wide ? 50 : 42), 76);
      savedLabel.at(wide ? aside : w * 0.28, wide ? 120 : 660);
      savedValue.at(wide ? aside : w * 0.71, wide ? 190 : 675);
      sum.at(wide ? aside : w / 2, wide ? 224 : 708);
      highlight.at(wide ? aside : w * 0.71, wide ? 190 : 675, -1.2);
      inputs.forEach(({ mark, weight, hit }, j) => {
        const x = 16 + step * (j + 0.5);
        mark.at(x, inputY);
        weight.at(x, wide ? 124 : 164);
        hit.bounds({
          x: -Math.min(step - 2, 50) / 2,
          y: -22,
          width: Math.min(step - 2, 50),
          height: 44,
        });
        cells[j].mark.at(x, savedY);
        cells[j].name.at(x + 11, wide ? 194 : 246);
        arrows[j].set([x, inputY + 25], [x, savedY - 31]);
        branches[j].update(`M${x} ${railY}L${x} ${savedY + 31}`);
      });
      const first = 16 + step / 2,
        last = diagram - first,
        middle = diagram / 2;
      rail.update(`M${first} ${railY}H${last}`);
      brace.update(
        `M${first - 15} ${railY + 12} Q${first - 15} ${railY + 22} ${first} ${railY + 22} H${middle - 17} Q${middle} ${railY + 22} ${middle} ${railY + 34} Q${middle} ${railY + 22} ${middle + 17} ${railY + 22} H${last} Q${last + 15} ${railY + 22} ${last + 15} ${railY + 12}`,
      );
    }
    enable.at(diagram * 0.25, controlY);
    tick.at(diagram * 0.75, controlY);
    enableNote.at(diagram * 0.25, controlY - 35);
    tickNote.at(diagram * 0.75, controlY - 35);
    inputs.forEach(({ mark, hit }, j) => {
      const value = bit(next.input, bits[j]);
      mark.value(value);
      mark.pigment('blue');
      mark.element.style.setProperty('--ve-wash-strength', value ? '12%' : '0%');
      hit.update({
        label: 'Входной бит ' + bits[j] + ': ' + value,
        pressed: Boolean(value),
        disabled: Boolean(next.challenge),
      });
      cells[j].mark.value(bit(next.saved, bits[j]));
      cells[j].mark.pigment('blue');
      cells[j].mark.element.style.setProperty(
        '--ve-wash-strength',
        bit(next.saved, bits[j]) ? '12%' : '0%',
      );
      cells[j].hit.update({
        label: 'Рассмотреть бит ' + bits[j] + ': ' + bit(next.saved, bits[j]),
        pressed: bits[j] === next.selected,
      });
      arrows[j].pigment('blue');
      const opacity = story.single && bits[j] !== 5 ? '.25' : '1';
      mark.element.style.opacity = opacity;
      cells[j].mark.element.style.opacity = opacity;
      cells[j].name.element.style.opacity = opacity;
      inputs[j].weight.element.style.opacity = opacity;
      arrows[j].element.style.opacity = story.single ? '.2' : story.focus === 'write' ? '1' : '.5';
    });
    inputValue.label.text(next.input);
    savedValue.label.text(next.saved);
    const savedBits = binary(next.saved);
    sum.label.text(savedBits.slice(0, 4) + ' ' + savedBits.slice(4) + '₂');
    highlight.content.setAttribute('transform', `scale(${(savedValue.label.width + 25) / 100} 1)`);
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
      'M' +
        (diagram * 0.75 + tick.width / 2) +
        ' ' +
        controlY +
        'H' +
        (diagram - 6) +
        'V' +
        railY +
        'H' +
        (diagram - 16 - step / 2),
    );
    group.show(!story.single);
    const positions = {
      input: [diagram / 2, wide ? 90 : 110, diagram - 36],
      memory: wide ? [aside, 268, w - diagram - 36] : [w / 2, 408, w - 36],
      enable: [diagram * 0.25, controlY + 48, diagram / 2 - 24],
      clock: [diagram * 0.75, controlY + 48, diagram / 2 - 24],
    };
    for (const [name, { mark, label }] of Object.entries(annotations)) {
      const fact = story[name];
      mark.show(Boolean(fact));
      if (name === 'memory') mark.pigment(next.event === 'blocked' ? 'red' : 'blue');
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
    if (!wide) {
      const notesBottom = Math.max(
        controlY + 22,
        ...['enable', 'clock'].map((name) =>
          story[name]
            ? controlY +
              48 +
              annotations[name].label.bounds.y +
              annotations[name].label.bounds.height
            : 0,
        ),
      );
      const resultY = Math.max(675, notesBottom + 80),
        nextHeight = resultY + 48;
      savedLabel.at(w * 0.28, resultY - 15);
      savedValue.at(w * 0.71, resultY);
      sum.at(w / 2, resultY + 33);
      highlight.at(w * 0.71, resultY, -1.2);
      if (height !== nextHeight) {
        height = nextHeight;
        view.resize(w, height, false);
      }
    }
    // The same short emphasis crosses all eight connections together. State is atomic.
    const elapsed = frame.elapsed('write_42');
    const flowing = mode === 'story' && frame.has('write_42') && elapsed < 0.7 && !frame.reduced;
    transfer.show(flowing);
    if (flowing)
      pulses.forEach((line, j) => {
        const x = 16 + step * (j + 0.5),
          y = inputY + 26 + (14 * elapsed) / 0.7;
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
    lettering(view.layer, 'НЕ', { x: x + 16, y: 64, size: 20 });
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
