import { InkStroke3D, InkConnection3D, ThreeKit as T } from '@visual-storytelling/core/three';

/** The recurrent diagram owns its figures; the viewport and connections own projection and routes. */
export function recurrentDiagram(view, words) {
  const group = new T.Group();
  group.name = 'recurrent-diagram';
  function card(text, color, width = 2.9, height = 1.1) {
    const body = new T.Mesh(
      new T.PlaneGeometry(width, height),
      view.ink(new T.MeshBasicMaterial({ side: T.DoubleSide }), `${color}-wash`),
    );
    body.name = text;
    group.add(body);
    const contour = InkStroke3D.create(
      view,
      [
        [-width / 2, -height / 2],
        [width / 2, -height / 2],
        [width / 2, height / 2],
        [-width / 2, height / 2],
        [-width / 2, -height / 2],
      ],
      { color, width: 1.5 },
    );
    body.add(contour.root);
    view.label(text, body, { face: ['front', 'back'] }).update(view.camera);
    return body;
  }
  const input = words.map((word) => card(word, 'blue', 1.8, 0.85));
  const encoder = card('кодировщик', 'blue'),
    memory = card('состояние', 'purple'),
    decoder = card('декодировщик', 'orange');
  const stateAnchor = new T.Group(),
    outputAnchor = new T.Group();
  group.add(stateAnchor, outputAnchor);
  const stateLabel = view.label('h₀', stateAnchor, {
    space: 'world',
    height: 0.46,
    maxWidth: 1.35,
    tone: 'purple',
  });
  const outputLabel = view.label('…', outputAnchor, {
    space: 'world',
    height: 0.46,
    maxWidth: 2.9,
    tone: 'orange',
  });
  let model,
    placement,
    reading = -1,
    written = '';
  view.describe(memory, 'recurrent-state', {
    label: 'Состояние: раскрыть, что переносится между словами',
    value: () => model?.completed,
    unit: 'прочитанных слов',
    inputs: () => words.slice(0, model?.completed ?? 0),
  });
  function place(column) {
    input.forEach((word, i) => word.position.set((i - 1) * 2.1, column ? 4.7 : 3, 0));
    encoder.position.set(column ? 0 : -3.6, column ? 2.6 : 0.45, 0);
    memory.position.set(0, column ? 0.2 : 0.45, 0);
    decoder.position.set(column ? 0 : 3.6, column ? -2.2 : 0.45, 0);
    stateAnchor.position.set(
      memory.position.x + (column ? 2.1 : 0),
      memory.position.y + (column ? 0 : 0.95),
      0,
    );
    outputAnchor.position.set(decoder.position.x - 1.4, decoder.position.y - 1.3, 0);
  }
  place(false);
  const obstacles = [...input, encoder, memory, decoder, stateLabel, outputLabel];
  const connect = (from, to, color, extra = {}) =>
    InkConnection3D.create(view, from, to, {
      space: group,
      avoid: obstacles,
      color,
      opacity: 0.8,
      width: 1.7,
      clearance: 0.25,
      ...extra,
    });
  const read = connect(input[0], encoder, 'blue', { toSide: 'top' }),
    remember = connect(encoder, memory, 'purple'),
    send = connect(memory, decoder, 'purple'),
    feedback = connect(decoder, decoder, 'orange', {
      fromSide: 'bottom',
      toSide: 'right',
      clearance: 0.55,
    });
  const links = [read, remember, send, feedback];
  const signal = new T.Mesh(
    new T.SphereGeometry(0.095, 16, 10),
    view.ink(new T.MeshBasicMaterial(), 'red'),
  );
  signal.name = 'travelling-signal';
  group.add(signal);
  view.setObject(group, { fitView: false });
  return {
    render(next, column) {
      const layoutChanged = placement !== column;
      model = next;
      place(column);
      const state = `h${'₀₁₂₃'[next.completed]}`;
      const stateChanged = stateLabel.element.textContent !== state;
      if (stateChanged) stateLabel.set(state);
      const word = next.output.at(-1) ?? '…';
      const wordChanged = word !== written;
      if (wordChanged) {
        written = word;
        outputLabel.set(word);
      }
      if (layoutChanged || reading !== next.active || stateChanged || wordChanged) {
        read.update({ from: input[next.active] });
        for (const link of links.slice(1)) link.update();
        // The complete causal chain is readable before the travelling signal starts.
        links.forEach((link) => link.draw(1));
        placement = column;
        reading = next.active;
      }
      const route =
        next.phase === 'read'
          ? read
          : next.phase === 'transfer'
            ? next.progress < 0.5
              ? remember
              : send
            : feedback;
      const progress = next.phase === 'transfer' ? (next.progress * 2) % 1 : next.progress;
      const point = route.pointAt(progress);
      signal.visible = !next.reduced && next.time > 0 && next.time < 14 && Boolean(point);
      if (point) signal.position.fromArray(point);
      if (layoutChanged) view.shot({ target: group, direction: [0, 0, 10], padding: 24 });
      view.invalidate();
    },
    snapshot() {
      return {
        layout: placement ? 'column' : 'row',
        signal: { visible: signal.visible, position: signal.position.toArray() },
        routes: links.map((link) => link.route),
        camera: view.capture(),
      };
    },
  };
}
