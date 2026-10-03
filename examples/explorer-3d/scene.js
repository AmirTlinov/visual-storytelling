import { SceneShell, interpolate } from '@visual-storytelling/core';
import { ThreeKit, Viewport3D } from '@visual-storytelling/core/three';
import narrationTiming from './timeline.json' with { type: 'json' };
/* Replace this subject file; reuse the shell, player and 3D surface unchanged. */
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('ve-scene'),
    T = ThreeKit;
  let view,
    symbolic = false,
    rendered;
  const shell = SceneShell.mount(root, {
    title: 'Как тензор меняет форму',
    parameters: ['x', 'y', 'z'].map((axis, i) => ({
      key: axis,
      label: `Масштаб по ${axis}`,
      min: 0.4,
      max: 2,
      step: 0.05,
      value: [1.65, 1, 0.7][i],
    })),
  });
  view = Viewport3D.mount(shell.stage, { label: 'Сфера и её образ при линейном преобразовании' });
  shell.attachView(view);
  const model = new T.Group(),
    shape = new T.Group();
  model.add(shape);
  const surface = new T.Mesh(
    new T.SphereGeometry(1, 64, 40),
    view.ink(new T.MeshBasicMaterial(), 'purple-wash'),
  );
  shape.add(surface);
  const gridMaterial = view.ink(new T.LineBasicMaterial(), 'ink');
  const line = (points) => {
    const geometry = new T.BufferGeometry().setFromPoints(points);
    const l = new T.Line(geometry, gridMaterial);
    shape.add(l);
  };
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const b = (latitude * Math.PI) / 180;
    line(
      Array.from({ length: 129 }, (_, j) => {
        const a = (j * Math.PI) / 64;
        return new T.Vector3(
          Math.cos(b) * Math.cos(a),
          Math.sin(b),
          Math.cos(b) * Math.sin(a),
        ).multiplyScalar(1.002);
      }),
    );
  }
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    line(
      Array.from({ length: 65 }, (_, j) => {
        const b = -Math.PI / 2 + (j * Math.PI) / 64;
        return new T.Vector3(
          Math.cos(b) * Math.cos(a),
          Math.sin(b),
          Math.cos(b) * Math.sin(a),
        ).multiplyScalar(1.002);
      }),
    );
  }
  const axes = ['x', 'y', 'z'].map((key, i) => {
    const end = new T.Vector3();
    end.setComponent(i, 1);
    const material = view.ink(
      new T.LineBasicMaterial({ depthTest: false }),
      ['blue', 'orange', 'purple'][i],
    );
    const path = new T.Line(
      new T.BufferGeometry().setFromPoints([
        end.clone().multiplyScalar(-1.16),
        end.clone().multiplyScalar(1.16),
      ]),
      material,
    );
    path.renderOrder = 2;
    shape.add(path);
    const text = view.label('', () => end.clone().multiply(shape.scale).multiplyScalar(1.3), {
      tone: ['blue', 'orange', 'purple'][i],
      offset: [i === 0 ? 8 : 0, i === 1 ? -8 : 0],
    });
    return { key, text };
  });
  view.setObject(model);
  const reference = new T.Box3(new T.Vector3(-2.5, -1.5, -1.5), new T.Vector3(2.5, 1.5, 1.5));
  const overview = { target: reference, direction: [3.2, 2, 4.5], padding: 36 };
  const front = { target: reference, direction: [0, 0, 1], padding: 36 };
  const notation = document.createElement('div');
  notation.className = 've-label';
  notation.style.cssText = 'left:50%;bottom:0;top:auto';
  shell.stage.append(notation);
  const tip = document.createElement('p');
  tip.textContent = 'Поверните фигуру · колесо — ближе';
  const formulas = document.createElement('button');
  formulas.type = 'button';
  formulas.dataset.mode = 'formulas';
  formulas.textContent = 'Формулы';
  formulas.setAttribute('aria-pressed', 'false');
  formulas.addEventListener('click', () => {
    symbolic = !symbolic;
    formulas.setAttribute('aria-pressed', symbolic);
    render(shell.parameters);
  });
  shell.actions.append(tip, formulas);
  function render(values) {
    const stamp = [values.x, values.y, values.z, symbolic].join();
    if (stamp === rendered) return;
    rendered = stamp;
    shape.scale.set(values.x, values.y, values.z);
    axes.forEach(({ key, text }, i) => {
      text.element.textContent = symbolic
        ? `${['a', 'b', 'c'][i]} = ${values[key].toFixed(2)}`
        : `${key} × ${values[key].toFixed(2)}`;
    });
    notation.textContent = symbolic
      ? `T = diag(${values.x.toFixed(2)}, ${values.y.toFixed(2)}, ${values.z.toFixed(2)})`
      : '';
    view.invalidate();
  }
  const timing = narrationTiming;
  const story = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt: (frame) => ({
      x: interpolate(1, 2, frame.progress('stretch_action')),
      y: interpolate(1, 0.5, frame.progress('compress_action')),
      z: 1,
    }),
    render(values, frame) {
      render(values);
      view.shot(
        frame.has('view_whole')
          ? {
              ...overview,
              from: front,
              progress: frame.progress('view_whole'),
              reduced: frame.reduced,
            }
          : {
              ...front,
              from: overview,
              progress: frame.progress('view_front'),
              reduced: frame.reduced,
            },
      );
    },
  });
  render(shell.parameters);
  // Intentional public handle for capture/export and embedding; no second clock.
  Object.assign(root.scene, { shell, view, story });
})().catch((error) => {
  const root = document.getElementById('ve-scene');
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = `Не удалось открыть сцену: ${error.message}`;
  root.append(message);
  throw error;
});
