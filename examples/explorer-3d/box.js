import { ThreeKit as T } from '@visual-storytelling/core/three';
import { cellState, volume } from './model.js';

// The box, centimetre cells and their labels share this one spatial owner.
export function measuringBox(view) {
  const group = new T.Group();
  const geometry = new T.BoxGeometry(0.985, 0.985, 0.985);
  const tones = ['blue', 'orange', 'purple'];
  const materials = tones.map((tone) => [
    view.ink(new T.MeshBasicMaterial(), (p) => p[`${tone}-wash`].clone().lerp(p.ink, 0.07)),
    view.ink(new T.MeshBasicMaterial(), `${tone}-wash`),
    view.ink(new T.MeshBasicMaterial(), `${tone}-wash`),
    view.ink(new T.MeshBasicMaterial(), (p) => p[`${tone}-wash`].clone().lerp(p.ink, 0.08)),
    view.ink(new T.MeshBasicMaterial(), `${tone}-wash`),
    view.ink(new T.MeshBasicMaterial(), `${tone}-wash`),
  ]);
  const outline = view.ink(new T.LineBasicMaterial({ transparent: true, opacity: 0.64 }), 'ink');
  const edges = new T.EdgesGeometry(geometry);
  const cells = [];
  for (let y = 0; y < 3; y++)
    for (let z = 0; z < 3; z++)
      for (let x = 0; x < 6; x++) {
        const cube = new T.Mesh(geometry, materials[y]);
        cube.add(new T.LineSegments(edges, outline));
        group.add(cube);
        cells.push({ x, y, z, cube });
      }
  const first = cells[0].cube;
  view.describe(first, 'unit-cube', {
    label: 'Единичный кубик',
    value: () => 1,
    unit: 'см³',
    source: { file: 'box.js' },
  });
  let capacity = 0;
  view.describe(group, 'measuring-box', {
    label: 'Объём коробки',
    value: () => capacity,
    unit: 'см³',
    inputs: () => ['unit-cube'],
    source: { file: 'box.js' },
  });
  const unitVolume = view.label('1 см³', first, {
    face: ['front', 'back'],
    tone: 'blue',
  });
  const label = (text, position, tone = 'ink', size = 22) => {
    const anchor = new T.Object3D();
    anchor.position.set(...position);
    group.add(anchor);
    return { anchor, text: view.label(text, anchor, { tone, size }) };
  };
  const dimensions = [
    label('', [1.5, -0.18, 0.6], 'blue'),
    label('', [3.6, 0.04, -1], 'blue'),
    label('', [-0.45, 1.3, 0.1], 'orange'),
  ];
  const unitSizes = [
    {
      position: [0, -0.85, 0.57],
      ends: [
        [-0.5, -0.64, 0.52],
        [0.5, -0.64, 0.52],
      ],
      tick: [0, 0.07, 0],
    },
    {
      position: [0.95, 0, 0.52],
      ends: [
        [0.65, -0.5, 0.52],
        [0.65, 0.5, 0.52],
      ],
      tick: [0.07, 0, 0],
    },
    {
      position: [0.66, 0.82, 0],
      ends: [
        [0.64, 0.65, -0.5],
        [0.64, 0.65, 0.5],
      ],
      tick: [0.07, 0, 0],
    },
  ].map(({ position, ends, tick }) => {
    const anchor = new T.Object3D();
    anchor.position.set(...position);
    first.add(anchor);
    const points = ends.map((p) => new T.Vector3(...p));
    for (const end of ends)
      points.push(
        new T.Vector3(...end.map((n, i) => n - tick[i])),
        new T.Vector3(...end.map((n, i) => n + tick[i])),
      );
    const bracket = new T.LineSegments(
      new T.BufferGeometry().setFromPoints(points),
      view.ink(new T.LineBasicMaterial(), 'blue'),
    );
    first.add(bracket);
    return { bracket, text: view.label('1 см', anchor, { tone: 'blue', size: 18 }) };
  });
  function wire(tone, opacity = 1) {
    const material = view.ink(new T.LineBasicMaterial({ transparent: true, opacity }), tone);
    const shape = new T.LineSegments(new T.BufferGeometry(), material);
    group.add(shape);
    let signature;
    return {
      shape,
      box(a, b) {
        const next = [...a, ...b].join();
        if (next === signature) return;
        signature = next;
        const points = [];
        for (let axis = 0; axis < 3; axis++)
          for (let i = 0; i < 2; i++)
            for (let j = 0; j < 2; j++) {
              const p = [...a],
                q = [...a],
                other = [0, 1, 2].filter((k) => k !== axis);
              p[other[0]] = q[other[0]] = i ? b[other[0]] : a[other[0]];
              p[other[1]] = q[other[1]] = j ? b[other[1]] : a[other[1]];
              q[axis] = b[axis];
              points.push(new T.Vector3(...p), new T.Vector3(...q));
            }
        shape.geometry.dispose();
        shape.geometry = new T.BufferGeometry().setFromPoints(points);
      },
    };
  }
  const boundary = wire('ink', 0.5),
    originalHalf = wire('purple', 0.65),
    highlight = wire('blue', 0.95);
  view.setObject(group);
  return {
    group,
    first,
    render(state, frame, exploring) {
      capacity = volume(state);
      frame.target('unit_volume', 'unit-cube');
      frame.target('volume_result', 'measuring-box');
      let settled = 0;
      cells.forEach(({ x, y, z, cube }) => {
        const cell = cellState(x, y, z, state, exploring);
        cube.visible = cell.visible;
        cube.position.set(...cell.position);
        if (cell.visible && cell.settled) settled++;
      });
      const has = (id) => exploring || frame.has(id);
      const placed = exploring || state.place > 0;
      unitVolume.show(has('unit_volume') && !placed);
      unitSizes.forEach(({ bracket, text }, i) => {
        bracket.visible = !placed && frame.progress('unit_edge') > i / 3;
        text.show(bracket.visible);
      });
      const extent = exploring ? state.x : state.extent;
      boundary.box([0, 0, -state.z], [extent, state.y, 0]);
      originalHalf.shape.visible = !exploring && frame.has('compare_view');
      originalHalf.box([0, 0, -2], [3, 2, 0]);
      let text = '';
      if (exploring) text = `${state.x} × ${state.z} × ${state.y} = ${volume(state)} см³`;
      else if (frame.has('volume_product'))
        text = `6 × 2 × 2${frame.has('volume_result') ? ' = 24 см³' : ''}`;
      else if (frame.has('double_volume')) text = '12 + 12 = 24 см³';
      else if (frame.has('double_sum')) text = '12 + 12';
      else if (frame.has('prediction')) text = '12 + ?';
      else if (frame.has('stack_sum')) text = `6 + 6${frame.has('stack_total') ? ' = 12 см³' : ''}`;
      else if (frame.has('layer_name')) text = '3 + 3 = 6 см³';
      else if (frame.has('layer_sum')) text = `3 + 3${frame.has('layer_total') ? ' = 6 см³' : ''}`;
      else if (frame.has('row_count'))
        text = `1 + 1 + 1 = 3${frame.has('row_volume') ? ' см³' : ''}`;
      dimensions[0].anchor.position.set(state.x / 2, 0, 0.65);
      dimensions[1].anchor.position.set(state.x + 0.5, 0.3, -state.z / 2);
      dimensions[2].anchor.position.set(-0.5, state.y / 2, -0.1);
      dimensions.forEach(({ text: t }, i) => {
        t.set(
          [
            `${state.x} в ряду`,
            `${state.z} ${state.z === 1 ? 'ряд' : 'ряда'}`,
            `${state.y} ${state.y === 1 ? 'слой' : 'слоя'}`,
          ][i],
        );
        const active = frame.has('count_height')
          ? 2
          : frame.has('count_depth')
            ? 1
            : frame.has('count_length')
              ? 0
              : -1;
        t.show(!exploring && !frame.has('volume_product') && i === active);
      });
      highlight.shape.visible = !exploring && has('row_count') && !frame.has('stack_view');
      if (frame.has('layer_name')) highlight.box([-0.02, 0, -2.02], [3.02, 1.02, 0.02]);
      else highlight.box([-0.02, 0, -1.02], [3.02, 1.02, 0.02]);
      if (!exploring && frame.has('count_length')) {
        highlight.shape.visible = !frame.has('volume_product');
        const depth = frame.has('count_depth') ? 2 : 1;
        const height = frame.has('count_height') ? 2 : 1;
        highlight.box([-0.02, 0, -depth - 0.02], [6.02, height + 0.02, 0.02]);
      }
      view.invalidate();
      return { settled, capacity: volume(state), formula: text };
    },
  };
}
