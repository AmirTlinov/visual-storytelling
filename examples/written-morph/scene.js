import { SceneShell, SketchControls, Morph, Morph2D, InkMorph } from '@visual-storytelling/core';
import { Viewport3D, Morph3D } from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';
import './style.css';

const cube = (text) => Morph.box([1.15, 1.15, 0.97], text);
const chapters = [
  {
    id: 'round',
    title: 'Та же единица',
    text: 'Форма округляется. Единица остаётся на её поверхности.',
    operation: Morph.transform(cube(1), Morph.sphere(0.69, 1)),
  },
  {
    id: 'sum',
    title: 'Части становятся целым',
    text: 'Один и два соединяются. Три рождается из тех же штрихов.',
    operation: Morph.merge([cube(1), cube(2)], Morph.box([2.25, 1.15, 0.97], 3)),
  },
  {
    id: 'meaning',
    title: 'Свет и тень',
    text: 'Свет очерчивает форму, тень даёт глубину. Вместе мы видим объём.',
    operation: Morph.merge(
      [cube('Свет'), Morph.sphere(0.575, 'Тень')],
      Morph.capsule(0.62, 2.6, 'Объём'),
    ),
  },
  {
    id: 'parts',
    title: 'Целое можно разделить',
    text: 'Шесть делится на три равные части. В каждой остаётся по два.',
    operation: Morph.split(Morph.capsule(0.62, 3.45, 6), [cube(2), cube(2), cube(2)]),
  },
  {
    id: 'words',
    title: 'Сами слова',
    text: 'Теперь тот же смысл несут сами штрихи: свет и тень превращаются в объём.',
    ink: { sources: ['Свет', 'Тень'], targets: ['Объём'] },
  },
  {
    id: 'paragraphs',
    title: 'Собираем мысль',
    text: 'Две мысли соединяются в одну. Можно остановить любой момент и провести переход назад.',
    ink: {
      sources: [
        'Свет очерчивает форму.\nМы видим границы предмета.',
        'Тень показывает глубину.\nМы чувствуем расстояние.',
      ],
      targets: ['Свет и тень создают объём.\nФорма и глубина складываются\nв единый образ.'],
    },
  },
];
const chapterDuration = 6.5;
const script = {
  duration: chapters.length * chapterDuration,
  segments: chapters.map((chapter, i) => ({
    id: chapter.id,
    title: chapter.title,
    text: chapter.text,
    start: i * chapterDuration,
    end: (i + 1) * chapterDuration,
  })),
  cues: Object.fromEntries(
    chapters.flatMap((chapter, i) => [
      [
        chapter.id,
        { start: i * chapterDuration, end: (i + 1) * chapterDuration, text: chapter.text },
      ],
      [
        `${chapter.id}_change`,
        { start: i * chapterDuration + 0.8, end: i * chapterDuration + 4.2, action: chapter.text },
      ],
    ]),
  ),
};

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('written-morph');
  const shell = SceneShell.mount(root, {
    title: 'Форма несёт смысл',
    parameters: [
      {
        key: 'chapter',
        type: 'choice',
        label: 'Превращение',
        value: 'round',
        options: chapters.map((c) => ({ value: c.id, label: c.title })),
      },
      {
        key: 'progress',
        label: 'Переход',
        min: 0,
        max: 1,
        step: 0.005,
        value: 0,
        format: (v) => `${Math.round(Number(v) * 100)}%`,
      },
    ],
  });
  const volumeStage = document.createElement('div'),
    flatStage = document.createElement('div'),
    inkStage = document.createElement('div');
  volumeStage.className = flatStage.className = 'written-solid';
  inkStage.className = 'written-ink';
  flatStage.hidden = inkStage.hidden = true;
  shell.stage.append(volumeStage, flatStage, inkStage);
  const view = Viewport3D.mount(volumeStage, {
    label: 'Формы и надписи превращаются вместе. Поверните предмет, чтобы рассмотреть поверхность.',
  });
  shell.attachView(view);
  const morph = Morph3D.mount(view, chapters[0].operation);
  const flat = Morph2D.mount(flatStage, chapters[0].operation, { id: 'written-flat', height: 430 });
  const writing = await InkMorph.mount(inkStage, chapters[4].ink, { color: 'var(--ve-blue)' });
  view.setObject(morph.object, { fitView: false });
  let active = 'round',
    projection = 'volume',
    isInk = false;
  const representation = SketchControls.field(
    {
      type: 'choice',
      label: 'Рисунок',
      value: 'volume',
      options: [
        { value: 'volume', label: 'Объём' },
        { value: 'flat', label: 'Плоскость' },
      ],
    },
    (value) => {
      projection = value;
      show();
      flat.render(morph.progress);
      morph.render(morph.progress);
    },
  );
  representation.element.classList.add('written-projection');
  shell.stage.before(representation.element);
  function show() {
    inkStage.hidden = !isInk;
    volumeStage.hidden = isInk || projection !== 'volume';
    flatStage.hidden = isInk || projection !== 'flat';
    representation.element.hidden = isInk;
    view.invalidate();
  }
  const story = shell.attachStory({
    script,
    stateAt(frame) {
      const chapter = chapters.findLast((c) => frame.has(c.id)) ?? chapters[0];
      return {
        chapter: chapter.id,
        progress: frame.progress(`${chapter.id}_change`),
      };
    },
    render(state, frame, mode) {
      if (active !== state.chapter) {
        active = state.chapter;
        const chapter = chapters.find((c) => c.id === active);
        isInk = !!chapter.ink;
        show();
        if (isInk) writing.setOperation(chapter.ink);
        else {
          morph.setOperation(chapter.operation);
          flat.setOperation(chapter.operation);
        }
      }
      const time = mode === 'story' ? frame : state.progress;
      const cue = `${active}_change`;
      if (isInk) writing.render(time, cue);
      else {
        view.shot({
          target: morph.bounds,
          direction: [-3.5, 2.2, 9],
          padding: 48,
          reduced: frame.reduced,
        });
        morph.render(time, cue);
        flat.render(time, cue);
      }
    },
  });
  Object.assign(root.scene, { view, story, morph });
  shell.onDispose(() => {
    flat.dispose();
    writing.dispose();
    representation.dispose();
  });
})();
