import {
  InkFusion,
  InkMorph,
  SketchControls,
  transport,
  player,
  widgetState,
} from '@visual-storytelling/core';
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
  const motionRevision = 10;
  const clock = transport({ duration: 4 });
  const view = await InkMorph.mount(
    stage,
    { sources: ['свет', 'тень'], targets: ['объём'] },
    { color: 'var(--ve-blue)' },
  );
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
  let ready = false,
    timer = 0,
    disposed = false;
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
      view.setTension(tension);
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
        { value: 'split', label: 'Разделить' },
        { value: 'repeat', label: 'Повторить' },
        { value: 'gather', label: 'Три в одну' },
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
      privateContent: { time: clock.state.time, motionRevision },
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
    let shapes, texts;
    if (scenario === 'drops') {
      const drop = (radius) =>
        InkFusion.shape(radius * 2 + 112, radius * 2 + 112, (context) => {
          context.beginPath();
          context.arc(radius + 56, radius + 56, radius, 0, Math.PI * 2);
          context.fill();
        });
      shapes = { sources: [drop(38), drop(38)], targets: [drop(38 * Math.SQRT2)] };
      equation.textContent = 'две капли → одна';
    } else {
      texts =
        scenario === 'letters'
          ? { sources: ['о', 'о'], targets: ['ю'] }
          : scenario === 'split'
            ? { sources: ['свет и тень'], targets: ['свет', 'тень'] }
            : scenario === 'repeat'
              ? { sources: ['2'], targets: ['2', '2', '2'] }
              : scenario === 'gather'
                ? { sources: ['свет', 'форма', 'тень'], targets: ['объём'] }
                : { sources: words.slice(0, 2), targets: words.slice(2) };
      shapes = texts;
      equation.textContent = `${texts.sources.join(' + ')} → ${texts.targets.join(' + ')}`;
    }
    view.setOperation(shapes);
    view.setTension(tension);
    fields.forEach((field) => {
      field.element.hidden = !presets[scenario];
    });
    render(clock.state.time);
  }
  function render(time) {
    if (!disposed) view.render(time / clock.state.duration);
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
    if (
      [
        'words',
        'sentences',
        'paragraphs',
        'letters',
        'drops',
        'split',
        'repeat',
        'gather',
      ].includes(model?.example)
    )
      scenario = model.example;
    clearTimeout(timer);
    timer = 0;
    clock.pause();
    fields.forEach((field, i) => field.setValue(words[i]));
    strength.setValue(tension);
    cases.setValue(scenario);
    rebuild();
    if (
      snapshot.privateContent?.motionRevision === motionRevision &&
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
    duration: clock.state.duration,
    get currentTime() {
      return clock.state.time;
    },
    play: clock.play,
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
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      abort.abort();
      unsubscribe();
      controls.dispose();
      clock.dispose();
      fields.forEach((field) => field.dispose());
      strength.dispose();
      cases.dispose();
      persistence.dispose();
      view.dispose();
      delete root.scene;
    },
  };
  if ((!restored || saved?.privateContent?.motionRevision !== motionRevision) && !reduced.matches)
    void clock.play();
})().catch((error) => {
  document.querySelector('.fusion-error').textContent = error.message;
  throw error;
});
