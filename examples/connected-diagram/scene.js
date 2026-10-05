import { SceneShell } from '@visual-storytelling/core';
import { cueSheet } from '@visual-storytelling/core/story';
import {
  Viewport3D,
  InkStroke3D,
  InkConnection3D,
  ThreeKit as T,
} from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';

const script = {
  duration: 14,
  cues: {
    read: { start: 0, end: 5, action: 'Кодировщик читает слова по очереди.' },
    memory: { start: 5, end: 8, action: 'Состояние памяти передаётся декодировщику.' },
    answer: {
      start: 8,
      end: 14,
      action: 'Декодировщик обновляет своё состояние и выбирает следующее слово.',
    },
  },
};
const sheet = cueSheet(script);
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('diagram');
  const shell = SceneShell.mount(root, {
    title: 'Как из слов получается ответ?',
    parameters: [
      { key: 'column', type: 'toggle', label: 'В столбик', value: false },
      { key: 'details', type: 'toggle', label: 'Подробная подпись', value: false },
      {
        key: 'time',
        label: 'Момент',
        value: 0,
        min: 0,
        max: 14,
        step: 0.05,
        format: (v) => `${Number(v).toFixed(1)} с`,
      },
    ],
  });
  const view = Viewport3D.mount(shell.stage, { label: 'Слова, кодировщик, память и декодировщик' });
  shell.attachView(view);
  const group = new T.Group();
  function card(text, x, y, color, width = 2.6) {
    const body = new T.Mesh(
      new T.PlaneGeometry(width, 1),
      view.ink(new T.MeshBasicMaterial({ side: T.DoubleSide }), `${color}-wash`),
    );
    body.position.set(x, y, 0);
    group.add(body);
    const contour = InkStroke3D.create(
      view,
      [
        [-width / 2, -0.5],
        [width / 2, -0.5],
        [width / 2, 0.5],
        [-width / 2, 0.5],
        [-width / 2, -0.5],
      ],
      { color, width: 1.5 },
    );
    body.add(contour.root);
    const label = view.label(text, body, { face: ['front', 'back'] });
    label.update(view.camera);
    return body;
  }
  const words = ['кот', 'на', 'крыше'].map((word, i) =>
    card(word, (i - 1) * 3.2, 3.2, 'blue', 2.2),
  );
  const encoder = card('кодировщик', -4, 0, 'blue'),
    memory = card('память', 0, 0, 'purple'),
    decoder = card('декодировщик', 4, 0, 'orange');
  const noteAnchor = new T.Group();
  noteAnchor.position.set(0, 1.6, 0);
  group.add(noteAnchor);
  const note = view.label('h и c', noteAnchor, {
    space: 'world',
    height: 0.36,
    maxWidth: 5.2,
    tone: 'purple',
  });
  const all = [...words, encoder, memory, decoder, note];
  const createLink = (from, to, color, extra = {}) =>
    InkConnection3D.create(view, from, to, {
      space: group,
      avoid: all,
      color,
      opacity: 0.75,
      width: 1.7,
      clearance: 0.24,
      ...extra,
    });
  const read = createLink(words[0], encoder, 'blue', { toSide: 'top' }),
    remember = createLink(encoder, memory, 'purple'),
    send = createLink(memory, decoder, 'purple'),
    feedback = createLink(decoder, decoder, 'orange', {
      fromSide: 'bottom',
      toSide: 'right',
      clearance: 0.5,
    });
  const links = [read, remember, send, feedback];
  const signal = new T.Mesh(
    new T.SphereGeometry(0.085, 16, 10),
    view.ink(new T.MeshBasicMaterial(), 'orange'),
  );
  group.add(signal);
  view.setObject(group, { fitView: false });
  const story = shell.attachStory({
    script,
    stateAt: (frame) => ({ column: false, details: false, time: frame.time }),
    render(state, frame, mode) {
      const f = mode === 'story' ? frame : sheet.at(state.time, frame.reduced);
      const column = state.column || shell.stage.clientWidth < 620;
      shell.stage.style.height = column ? 'clamp(520px, 72vh, 760px)' : 'clamp(320px, 55vw, 450px)';
      words.forEach((word, i) =>
        word.position.set(
          column ? (i === 2 ? 0 : (i - 0.5) * 3.2) : (i - 1) * 3.2,
          column ? (i === 2 ? 3.2 : 4.7) : 3.2,
          0,
        ),
      );
      encoder.position.set(column ? 0 : -4, column ? 1.25 : 0, 0);
      memory.position.set(0, column ? -1 : 0, 0);
      decoder.position.set(column ? 0 : 4, column ? -3.25 : 0, 0);
      noteAnchor.position.set(column ? 1.8 : 0, column ? 2.05 : 1.6, 0);
      note.set(state.details ? 'общее состояние: h и c' : 'h и c');
      // Placement changes only the figures. Every link measures the same objects and inscriptions.
      const reading = Math.min(2.999999, f.reveal('read') * 3),
        active = Math.floor(reading);
      read.update({ from: words[active] });
      for (const link of links.slice(1)) link.update();
      const phases = [
        f.time >= 5 ? 1 : reading % 1,
        f.reveal('memory'),
        f.reveal('memory'),
        f.reveal('answer'),
      ];
      links.forEach((link, i) => link.draw(phases[i]));
      const route = f.time < 5 ? read : f.time < 8 ? send : feedback,
        progress = f.time < 5 ? reading % 1 : f.time < 8 ? phases[2] : phases[3];
      signal.visible = !f.reduced && progress > 0 && progress < 1;
      signal.position.fromArray(route.pointAt(progress));
      // Framing includes each complete route, so writing a line cannot move the camera.
      view.shot({ target: group, direction: [0, 0, 10], padding: 30 });
    },
  });
  root.scene.extend({ view, story });
})();
