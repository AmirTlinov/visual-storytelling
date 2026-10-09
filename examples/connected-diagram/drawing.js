import { InkStroke3D, InkConnection3D, ThreeKit as T } from '@visual-storytelling/core/three';

/** Nodes own the explanation; the viewport owns projection, selection and the camera. */
export function recurrentDiagram(view, words, answer) {
  const group = new T.Group(),
    history = new T.Group();
  group.name = 'recurrent-diagram';
  history.name = 'state-history';
  group.add(history);
  const fills = [];
  let model,
    expanded = false;
  function card(text, color, x, y, width = 3.1, height = 1.05, parent = group, active) {
    const body = new T.Mesh(
      new T.PlaneGeometry(width, height),
      view.ink(
        new T.MeshBasicMaterial({
          side: T.DoubleSide,
          transparent: true,
          opacity: 0.06,
          depthWrite: false,
        }),
        color,
      ),
    );
    body.name = text;
    body.position.set(x, y, 0);
    parent.add(body);
    fills.push({ material: body.material, active });
    const contour = InkStroke3D.create(
      view,
      [
        [-width / 2, -height / 2],
        [width / 2, -height / 2],
        [width / 2, height / 2],
        [-width / 2, height / 2],
        [-width / 2, -height / 2],
      ],
      { color, width: 1.7 },
    );
    body.add(contour.root);
    view.label(text, body, { face: ['front', 'back'], tone: color }).update(view.camera);
    return body;
  }
  function inscription(text, x, y, color, height = 0.46, maxWidth = 4, parent = group) {
    const anchor = new T.Group();
    anchor.position.set(x, y, 0);
    parent.add(anchor);
    return view.label(text, anchor, { space: 'world', height, maxWidth, tone: color });
  }
  const input = words.map((word, index) => {
    const body = card(
      word,
      'blue',
      -6.7 + index * 2.1,
      2.75,
      1.8,
      0.85,
      group,
      () => model?.phase === 'read' && model.active === index,
    );
    view.describe(body, `input-word-${index}`, {
      label: `Прочитать слово «${word}»`,
      value: () => word,
      provenance: () => ({ position: index + 1, state: `h${index + 1}` }),
    });
    return body;
  });
  const encoder = card(
      'кодировщик',
      'blue',
      -4.6,
      0.5,
      3.1,
      1.05,
      group,
      () => model?.phase === 'read',
    ),
    memory = card(
      'состояние',
      'purple',
      0,
      0.5,
      2.8,
      1.05,
      group,
      () => model?.phase === 'transfer',
    ),
    decoder = card(
      'декодировщик',
      'orange',
      4.6,
      0.5,
      3.2,
      1.05,
      group,
      () => model?.phase === 'answer',
    );
  const stateLabel = inscription('h₀', 0, 1.75, 'purple', 0.65, 1.7),
    outputLabel = inscription('…', 4.6, -2.2, 'orange', 0.58, 6.2),
    outputCount = inscription('0 / 6', 4.6, -3.05, 'muted', 0.36, 2);
  outputLabel.element.dataset.sequenceOutput = '';
  stateLabel.element.dataset.sequenceState = '';
  inscription('слово', -4.6, 3.6, 'blue', 0.42, 2);
  inscription('обновить', -2.35, 1.12, 'purple', 0.36, 1.65);
  inscription('передать', 2.25, 1.12, 'purple', 0.36, 1.65);
  inscription('пример перевода', 4.6, -1.4, 'orange', 0.38, 3.6);
  inscription('следующее слово', 6.6, 1.7, 'orange', 0.36, 3);
  const stateCards = [0, 1, 2, 3].map((index) => {
    const body = card(
      `h${'₀₁₂₃'[index]}`,
      'purple',
      -6.2 + index * 2,
      -2,
      1.25,
      0.75,
      history,
      () => model?.completed === index,
    );
    if (index) inscription(words[index - 1], -7.2 + index * 2, -2.92, 'blue', 0.38, 1.7, history);
    return body;
  });
  view.describe(memory, 'recurrent-state', {
    label: 'Состояние: раскрыть цепь обновлений',
    value: () => `h${model?.completed ?? 0}`,
    inputs: () => words.slice(0, model?.completed ?? 0),
    provenance: () => ({
      updates: model?.completed ?? 0,
      read: words.slice(0, model?.completed ?? 0),
    }),
  });
  view.describe(decoder, 'decoder-output', {
    label: 'Выходная фраза',
    value: () => model?.output.join(' ') ?? '',
    inputs: () => ['recurrent-state', ...(model?.output.slice(0, -1) ?? [])],
    provenance: () => ({ kind: 'given-sequence', words: answer }),
  });
  const obstacles = [...input, encoder, memory, decoder];
  const connect = (from, to, color, extra = {}) =>
    InkConnection3D.create(view, from, to, {
      space: group,
      avoid: obstacles,
      color,
      opacity: 0.85,
      width: 1.8,
      clearance: 0.24,
      ...extra,
    });
  const read = connect(input[0], encoder, 'blue', { toSide: 'top' }),
    remember = connect(encoder, memory, 'purple'),
    send = connect(memory, decoder, 'purple'),
    feedback = connect(decoder, decoder, 'orange', {
      fromSide: 'bottom',
      toSide: 'right',
      clearance: 0.9,
    });
  const stateLinks = stateCards.slice(1).map((body, index) =>
    connect(stateCards[index], body, 'purple', {
      space: history,
      avoid: stateCards,
      clearance: 0.12,
      width: 1.4,
    }),
  );
  const detailLink = connect(memory, stateCards.at(-1), 'purple', {
    space: history,
    avoid: [],
    fromSide: 'bottom',
    toSide: 'top',
    width: 1.3,
    dashed: true,
  });
  const links = [read, remember, send, feedback];
  const signal = new T.Mesh(
    new T.SphereGeometry(0.105, 16, 10),
    view.ink(new T.MeshBasicMaterial(), 'red'),
  );
  signal.name = 'travelling-signal';
  group.add(signal);
  view.setObject(group, { fitView: false });
  // The envelope reserves the expanded state chain. Revealing a detail keeps the camera still.
  view.shot({
    target: group,
    bounds: new T.Box3(new T.Vector3(-8, -3.25, 0), new T.Vector3(8.2, 4, 0)),
    direction: [0, 0, 10],
    padding: 12,
  });
  let reading = -1;
  return {
    render(next, details) {
      model = next;
      expanded = details;
      for (const fill of fills) fill.material.opacity = fill.active?.() ? 0.18 : 0.06;
      const state = `h${'₀₁₂₃'[next.completed]}`;
      if (stateLabel.element.textContent !== state) stateLabel.set(state);
      const phrase = next.output.length ? next.output.join(' ') : '…';
      if (outputLabel.element.textContent !== phrase) outputLabel.set(phrase);
      outputCount.set(`${next.output.length} / ${answer.length}`);
      if (reading !== next.active) {
        read.update({ from: input[next.active] });
        reading = next.active;
      }
      links.forEach((link) => link.draw(1));
      stateLinks.forEach((link) => link.draw(1));
      detailLink.draw(1);
      history.visible = details;
      const route =
        next.phase === 'read'
          ? next.progress < 0.5
            ? read
            : remember
          : next.phase === 'transfer'
            ? send
            : feedback;
      const progress = next.phase === 'read' ? (next.progress * 2) % 1 : next.progress;
      const point = route.pointAt(progress);
      signal.visible = !next.reduced && next.time > 0 && next.time < 14 && Boolean(point);
      if (point) signal.position.fromArray(point);
      view.invalidate();
    },
    snapshot() {
      return {
        layout: 'row',
        details: expanded,
        state: `h${model?.completed ?? 0}`,
        signal: { visible: signal.visible, position: signal.position.toArray() },
        routes: links.map((link) => link.route),
        camera: view.capture(),
      };
    },
  };
}
