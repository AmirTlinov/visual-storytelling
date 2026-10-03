import {
  InkFusion,
  SketchControls,
  transport,
  player,
  widgetState,
} from '@visual-storytelling/core';
import { Physics2D } from '@visual-storytelling/core/physics/2d';
import '@visual-storytelling/core/style.css';
import './style.css';

window.galleryReady = (async () => {
  await document.fonts.load('100px SketchPencil');
  await document.fonts.ready;
  const root = document.getElementById('ink-fusion-scene');
  const stage = root.querySelector('.fusion-stage');
  const equation = root.querySelector('.fusion-equation');
  const abort = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clock = transport({ duration: 4 });
  const view = await Physics2D.fusion(stage, {
    width: 840,
    height: 300,
    color: 'var(--ve-blue)',
    duration: clock.state.duration,
    frame: poseAt,
  });
  const presets = {
    words: ['свет', 'тень', 'объём'],
    sentences: ['Свет раскрывает форму.', 'Тень придаёт глубину.', 'Свет и тень создают объём.'],
    paragraphs: [
      'Свет очерчивает форму.\nМы видим границы предмета.',
      'Тень показывает глубину.\nМы чувствуем расстояние.',
      'Свет и тень создают объём.\nФорма и глубина складываются\nв единый образ.',
    ],
  };
  let words = [...presets.words],
    scenario = 'words',
    tension = 36;
  let shapes,
    layout,
    sceneWidth = 0,
    layoutFrame = 0,
    ready = false,
    timer = 0,
    disposed = false;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const smooth = (a, b, value) => {
    const t = clamp((value - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const persistence = widgetState('ink-fusion', restore);
  const fields = ['Первый текст', 'Второй текст', 'Третий текст'].map((label, i) => {
    const field = SketchControls.field({ type: 'textarea', label, value: words[i] }, () => {
      clock.pause();
      clearTimeout(timer);
      timer = setTimeout(changeTexts, 160);
    });
    field.element.querySelector('textarea').maxLength = 2000;
    root.querySelector('.fusion-inputs').append(field.element);
    return field;
  });
  const strength = SketchControls.field(
    {
      label: 'Натяжение',
      min: 0,
      max: 64,
      step: 1,
      value: tension,
      format: (v) => `${Math.round((Number(v) / 64) * 100)}%`,
    },
    (value) => {
      clock.pause();
      tension = Number(value);
      render(clock.state.time);
      save();
    },
  );
  root.querySelector('.fusion-tension').append(strength.element);
  const cases = SketchControls.field(
    {
      type: 'choice',
      label: 'Попробовать',
      value: scenario,
      options: [
        { value: 'words', label: 'Слова' },
        { value: 'sentences', label: 'Предложения' },
        { value: 'paragraphs', label: 'Абзацы' },
        { value: 'letters', label: 'Буквы' },
        { value: 'drops', label: 'Капли' },
      ],
    },
    (value) => {
      clearTimeout(timer);
      timer = 0;
      clock.pause();
      scenario = String(value);
      if (presets[scenario]) {
        words = [...presets[scenario]];
        fields.forEach((field, i) => field.setValue(words[i]));
      }
      clock.seek(0);
      rebuild();
      save();
      if (!reduced.matches) void clock.play();
    },
  );
  root.querySelector('.fusion-cases').append(cases.element);

  function save() {
    if (!ready || disposed) return;
    persistence.save({
      modelContent: { type: 'ink-fusion', texts: words, tension, example: scenario },
      privateContent: { time: clock.state.time, motionRevision: 5 },
    });
  }
  function changeTexts() {
    timer = 0;
    const next = fields.map((field) => String(field.value).trim());
    if (next.some((text) => !text)) return;
    words = next;
    if (!presets[scenario]) {
      scenario = 'words';
      cases.setValue(scenario);
    }
    clock.seek(0);
    rebuild();
    save();
  }
  function flush() {
    if (timer) {
      clearTimeout(timer);
      changeTexts();
    }
  }
  function rebuild() {
    sceneWidth = Math.max(240, stage.getBoundingClientRect().width);
    const block =
      Boolean(presets[scenario]) && words.some((text) => /\s/.test(text) || text.length > 14);
    if (scenario === 'drops') {
      const drop = (radius) =>
        InkFusion.shape(radius * 2 + 112, radius * 2 + 112, (context) => {
          context.beginPath();
          context.arc(radius + 56, radius + 56, radius, 0, Math.PI * 2);
          context.fill();
        });
      shapes = [drop(38), drop(38), drop(38 * Math.SQRT2)];
      equation.textContent = 'две капли → одна';
    } else {
      const text = scenario === 'letters' ? ['о', 'о', 'ю'] : words;
      const size =
        scenario === 'letters'
          ? Math.min(180, sceneWidth * 0.28)
          : block
            ? sceneWidth < 480
              ? 25
              : 30
            : Math.min(96, sceneWidth * 0.17);
      shapes = text.map((word, i) =>
        InkFusion.text(word, {
          size: i === 2 && !block ? size * 1.15 : size,
          maxWidth: block || i === 2 ? sceneWidth - 36 : (sceneWidth - 84) / 2,
          align: block ? 'left' : 'center',
        }),
      );
      equation.textContent = block ? 'Два текста → один' : `${text[0]} + ${text[1]} → ${text[2]}`;
    }
    view.canvas.setAttribute(
      'aria-label',
      scenario === 'drops' || scenario === 'letters'
        ? equation.textContent
        : `${words[0]} + ${words[1]} → ${words[2]}`,
    );
    const gap = block ? 68 : 64;
    layout = block
      ? {
          sources: [
            { x: 0, y: -(shapes[1].bounds.height + gap) / 2 },
            { x: 0, y: (shapes[0].bounds.height + gap) / 2 },
          ],
          block: true,
          height:
            Math.max(
              shapes[0].bounds.height + shapes[1].bounds.height + gap,
              shapes[2].bounds.height,
            ) + 64,
        }
      : {
          sources: [
            { x: -(shapes[1].bounds.width + gap) / 2, y: 0 },
            { x: (shapes[0].bounds.width + gap) / 2, y: 0 },
          ],
          block: false,
          height: Math.max(215, ...shapes.map((shape) => shape.bounds.height + 100)),
        };
    stage.style.height = `${layout.height}px`;
    view.setSize(sceneWidth, layout.height);
    view.setShapes(...shapes);
    fields.forEach((field) => {
      field.element.hidden = !presets[scenario];
    });
    render(clock.state.time);
  }
  function poseAt(time) {
    const t = time / clock.state.duration;
    const approach = smooth(0.03, 0.2, t);
    return {
      sources: layout.sources.map((pose, i) => ({
        x: pose.x + (layout.block ? 0 : (i ? -1 : 1) * 24 * approach),
        y: pose.y + (layout.block ? (i ? -1 : 1) * 24 * approach : 0),
      })),
      target: { x: 0, y: 0 },
      tension,
      morph: 1 - (1 - smooth(0.04, 0.9, t)) ** 2,
    };
  }
  function render(time) {
    if (!shapes || disposed) return;
    view.render(time);
  }
  function restore(snapshot) {
    if (!ready || disposed) return;
    const model = snapshot.modelContent;
    if (model?.type !== 'ink-fusion') return false;
    if (
      Array.isArray(model?.texts) &&
      model.texts.length === 3 &&
      model.texts.every((text) => typeof text === 'string' && text.trim())
    )
      words = model.texts.map((text) => text.slice(0, 2000));
    if (Number.isFinite(model?.tension)) tension = Math.max(0, Math.min(64, model.tension));
    if (['words', 'sentences', 'paragraphs', 'letters', 'drops'].includes(model?.example))
      scenario = model.example;
    clearTimeout(timer);
    timer = 0;
    clock.pause();
    fields.forEach((field, i) => field.setValue(words[i]));
    strength.setValue(tension);
    cases.setValue(scenario);
    rebuild();
    if (
      snapshot.privateContent?.motionRevision === 5 &&
      Number.isFinite(snapshot.privateContent?.time)
    )
      clock.seek(snapshot.privateContent.time);
    else clock.seek(0);
    return true;
  }
  const controls = player(root.querySelector('.fusion-player'), {
    transport: clock,
    stops: [0, 1, 1.7, 4],
    onPlay: flush,
    onSeek: (time) => {
      flush();
      clock.pause();
      clock.seek(time);
      save();
    },
  });
  const responsive = new ResizeObserver(() => {
    if (disposed || Math.abs(stage.getBoundingClientRect().width - sceneWidth) < 1) return;
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      if (ready && !disposed) rebuild();
    });
  });
  responsive.observe(stage);
  let wasPlaying = false;
  const unsubscribe = clock.subscribe((state) => {
    render(state.time);
    if (state.playing !== wasPlaying) {
      wasPlaying = state.playing;
      save();
    }
  });
  ready = true;
  const saved = persistence.read();
  const restored = saved && restore(saved);
  if (!restored) rebuild();
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) clock.pause();
    },
    { signal: abort.signal },
  );
  reduced.addEventListener(
    'change',
    (event) => {
      if (event.matches) clock.pause();
    },
    { signal: abort.signal },
  );
  root.scene = {
    seek: (time) => {
      clock.pause();
      clock.seek(time);
    },
    pause: clock.pause,
    review: () => ({ duration: 4, cues: [] }),
    snapshot: () => ({
      texts: words,
      scenario,
      tension,
      time: clock.state.time,
      physics: view.stats,
    }),
    dispose() {
      disposed = true;
      clearTimeout(timer);
      cancelAnimationFrame(layoutFrame);
      responsive.disconnect();
      abort.abort();
      unsubscribe();
      controls.dispose();
      clock.dispose();
      fields.forEach((field) => field.dispose());
      strength.dispose();
      cases.dispose();
      persistence.dispose();
      view.dispose();
    },
  };
  if ((!restored || saved?.privateContent?.motionRevision !== 5) && !reduced.matches)
    void clock.play();
})().catch((error) => {
  document.querySelector('.fusion-error').textContent = error.message;
  throw error;
});
