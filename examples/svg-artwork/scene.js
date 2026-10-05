import { SceneShell } from '@visual-storytelling/core';
import { Viewport3D, SvgArtwork3D, ThreeKit as T } from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const source = await fetch(new URL('./balloon.svg', import.meta.url)).then((response) => {
    if (!response.ok) throw new Error('Не удалось загрузить рисунок воздушного шара');
    return response.text();
  });
  const root = document.getElementById('artwork');
  const shell = SceneShell.mount(root, {
    title: 'Почему дальний кажется меньше?',
    parameters: [
      {
        key: 'depth',
        label: 'Глубина синего',
        min: -3,
        max: 3,
        step: 0.05,
        value: 0,
        format: (value) => Number(value).toFixed(1),
      },
      {
        key: 'size',
        label: 'Размер красного',
        min: 0.5,
        max: 1.2,
        step: 0.05,
        value: 1,
        format: (value) => `${Math.round(Number(value) * 100)}%`,
      },
      {
        key: 'opacity',
        label: 'Видимость красного',
        min: 0,
        max: 1,
        step: 0.05,
        value: 1,
        format: (value) => `${Math.round(Number(value) * 100)}%`,
      },
    ],
  });
  shell.stage.style.height = 'clamp(330px, 58vh, 540px)';
  const view = Viewport3D.mount(shell.stage, {
    label: 'Два одинаковых рисунка воздушного шара на разной глубине',
  });
  shell.attachView(view);
  const group = new T.Group();
  function balloon(id, tone, x) {
    const art = SvgArtwork3D.create(view, source, {
      height: 3,
      colors: { '#263238': 'ink', '#d8694e': tone, '#f6d9cb': `${tone}-wash` },
    });
    art.root.position.x = x;
    group.add(art.root);
    view.describe(art.root, id, {
      label: `${tone === 'blue' ? 'Синий' : 'Красный'} воздушный шар`,
      source: { file: 'balloon.svg' },
    });
    return art;
  }
  const red = balloon('red-balloon', 'red', -0.65),
    blue = balloon('blue-balloon', 'blue', 0.65);
  view.setObject(group, { fitView: false });
  // A stable shot covers the whole action; changing artwork size never moves the camera.
  const frameBounds = new T.Box3(new T.Vector3(-1.9, -1.9, -3), new T.Vector3(1.9, 1.9, 3));
  const story = shell.attachStory({
    script: {
      duration: 12,
      cues: {
        same: { start: 0, end: 2, hold: 'Оба рисунка одинакового размера.' },
        distance: {
          start: 2,
          end: 6,
          action: 'Синий отдаляется: его размер в мире остаётся прежним.',
        },
        return: { start: 7, end: 11, action: 'Синий приближается и заслоняет красный.' },
      },
    },
    stateAt: (frame) => ({
      depth: -3 * frame.reveal('distance') + 6 * frame.reveal('return'),
      size: 1,
      opacity: 1,
    }),
    render(values) {
      red.root.scale.setScalar(values.size);
      red.opacity(values.opacity);
      blue.root.position.z = values.depth;
      view.shot({ target: frameBounds, direction: [0, 0, 1], padding: 24 });
    },
  });
  root.scene.extend({ view, story });
})();
