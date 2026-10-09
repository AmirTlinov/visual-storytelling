import { SceneShell, MathMorph, Morph } from '@visual-storytelling/core';
import { cueSheet } from '@visual-storytelling/core/story';
import {
  Viewport3D,
  MathMorph3D,
  Morph3D,
  InkStroke3D,
  ThreeKit as T,
} from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';

const script = {
  duration: 13,
  cues: {
    inputs: { start: 0, end: 1, hold: 'Сначала число нужно вычислить.' },
    calculate: { start: 1, end: 7, action: 'Собираем результат из исходных чисел.' },
    read: { start: 7, end: 8, hold: 'Результат готов. Теперь он займёт своё место.' },
    place: { start: 8, end: 11, action: 'Переносим результат в свободную ячейку.' },
    stored: {
      start: 11,
      end: 13,
      hold: 'Результат хранится в ячейке. Перемотайте назад и проследите его путь.',
    },
  },
};
const sheet = cueSheet(script);
const operationFor = ({ example, input }) =>
  example === 'memory'
    ? MathMorph.calculate('add', input, 3)
    : MathMorph.dot([input, -1, 2], [0.5, 2, -1]);
const cellSize = [1.3, 1.3, 0.65];
const cellBounds = new T.Box3().setFromCenterAndSize(new T.Vector3(), new T.Vector3(...cellSize));
function cellOperation(value) {
  const body = Morph.box(cellSize, value);
  return Morph.transform(body, body);
}

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('delivery');
  const shell = SceneShell.mount(root, {
    title: 'Куда попадает результат?',
    parameters: [
      {
        key: 'example',
        type: 'choice',
        label: 'Пример',
        value: 'memory',
        options: [
          { value: 'memory', label: 'Записать сумму в память' },
          { value: 'vector', label: 'Собрать элемент вектора' },
        ],
      },
      { key: 'input', label: 'Первое число', min: -3, max: 5, step: 1, value: 2 },
      {
        key: 'time',
        label: 'Момент',
        min: 0,
        max: 13,
        step: 0.05,
        value: 0,
        format: (value) => `${Number(value).toFixed(1)} с`,
      },
      {
        key: 'angle',
        label: 'Поворот ячеек',
        min: -25,
        max: 25,
        step: 1,
        value: 0,
        format: (value) => `${value}°`,
      },
    ],
  });
  shell.stage.style.height = 'clamp(340px, min(70vh, 85vw), 640px)';
  const view = Viewport3D.mount(shell.stage, { label: 'Вычисление и запись результата в ячейку' });
  shell.attachView(view);
  const group = new T.Group(),
    row = new T.Group(),
    workbench = new T.Group();
  row.position.set(0, -2.8, -0.4);
  row.scale.set(1.05, 0.9, 0.85);
  row.rotation.y = -0.15;
  workbench.position.set(0, 1.3, 0);
  workbench.scale.setScalar(0.72);
  group.add(workbench, row);
  const receiver = Morph3D.mount(view, cellOperation(5), { pigment: 'blue' });
  receiver.object.name = 'stored-result';
  row.add(receiver.object);
  const slot = InkStroke3D.create(
    view,
    [
      [-0.78, -0.78, 0.34],
      [0.78, -0.78, 0.34],
      [0.78, 0.78, 0.34],
      [-0.78, 0.78, 0.34],
      [-0.78, -0.78, 0.34],
    ],
    { color: 'pencil', dashed: true, width: 1.4, dashSize: 0.12, gapSize: 0.1 },
  );
  row.add(slot.root);
  view.describe(
    receiver.object,
    'stored-result',
    {
      label: 'Записанный результат',
      value: () => calculation.plan.result,
    },
    { bounds: () => cellBounds.clone().applyMatrix4(receiver.object.matrixWorld) },
  );
  const neighbours = [-1, 1].map((side) => {
    const cell = Morph3D.mount(view, cellOperation(side === -1 ? 2 : -1), { pigment: 'purple' });
    cell.object.position.x = side * 1.8;
    row.add(cell.object);
    return cell;
  });
  const destinationLabel = view.label(
    'Память',
    {
      object: row,
      position: new T.Vector3(0, 1.4, 0.35),
    },
    { size: 24, tone: 'blue' },
  );
  const initial = { example: 'memory', input: 2 };
  const calculation = MathMorph3D.mount(view, operationFor(initial), {
    id: 'calculation',
    columns: 3,
    pigment: 'blue',
    delivery: { to: receiver.object, bounds: cellBounds },
  });
  calculation.object.name = 'calculation';
  workbench.add(calculation.object);
  view.setObject(group, { fitView: false });
  const frameBounds = new T.Box3(new T.Vector3(-4.5, -4.4, -1), new T.Vector3(4.5, 4.2, 1));
  let operationKey = 'memory/2';
  const story = shell.attachStory({
    script,
    stateAt: (frame) => ({ ...initial, time: frame.time, angle: 0 }),
    render(state, frame, mode) {
      const key = `${state.example}/${state.input}`;
      if (key !== operationKey) {
        calculation.setOperation(operationFor(state));
        receiver.setOperation(cellOperation(calculation.plan.result));
        operationKey = key;
      }
      neighbours.forEach((cell) => (cell.object.visible = state.example === 'vector'));
      destinationLabel.set(state.example === 'memory' ? 'Память' : 'Вектор [1]');
      row.rotation.z = (state.angle * Math.PI) / 180;
      // Manual exploration samples the same cues; there are no private timing fractions.
      calculation.render(
        mode === 'story' ? frame : sheet.at(state.time, frame.reduced),
        'calculate',
        'place',
      );
      view.shot({ target: frameBounds, direction: [0, 0.3, 10], padding: 28 });
    },
  });
  root.scene.extend({ view, story });
})();
