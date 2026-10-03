import {
  InkFusion,
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
  const clock = transport({ duration: 12 });
  const view = InkFusion.mount(stage, { width: 840, height: 300, color: 'var(--ve-blue)' });
  let words = ['свет', 'тень', 'объём'],
    scenario = 'words',
    tension = 36;
  let shapes,
    ready = false,
    timer = 0,
    disposed = false;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const smooth = (a, b, value) => {
    const t = clamp((value - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const centered = {
    sources: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    target: { x: 0, y: 0 },
  };
  const persistence = widgetState('ink-fusion', restore);
  const fields = ['Первый текст', 'Второй текст', 'Третий текст'].map((label, i) => {
    const field = SketchControls.field({ type: 'text', label, value: words[i] }, () => {
      clock.pause();
      clearTimeout(timer);
      timer = setTimeout(changeTexts, 160);
    });
    field.element.querySelector('input').maxLength = 32;
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
      view.prepare({ ...centered, tension });
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
        { value: 'letters', label: 'Буквы' },
        { value: 'drops', label: 'Капли' },
      ],
    },
    (value) => {
      clearTimeout(timer);
      timer = 0;
      clock.pause();
      scenario = String(value);
      rebuild();
      clock.seek(0);
      save();
      if (!reduced.matches) void clock.play();
    },
  );
  root.querySelector('.fusion-cases').append(cases.element);

  function save() {
    if (!ready || disposed) return;
    persistence.save({
      modelContent: { type: 'ink-fusion', texts: words, tension, example: scenario },
      privateContent: { time: clock.state.time },
    });
  }
  function changeTexts() {
    timer = 0;
    const next = fields.map((field) => String(field.value).trim());
    if (next.some((text) => !text)) return;
    words = next;
    scenario = 'words';
    cases.setValue(scenario);
    rebuild();
    clock.seek(0);
    save();
  }
  function flush() {
    if (timer) {
      clearTimeout(timer);
      changeTexts();
    }
  }
  function rebuild() {
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
      const size = scenario === 'letters' ? 220 : 126;
      shapes = text.map((word, i) =>
        InkFusion.text(word, { size: i === 2 ? size * 1.22 : size, maxWidth: i === 2 ? 610 : 285 }),
      );
      equation.textContent = `${text[0]} + ${text[1]} → ${text[2]}`;
    }
    view.canvas.setAttribute('aria-label', equation.textContent);
    view.setShapes(...shapes);
    view.prepare({ ...centered, tension });
    fields.forEach((field) => {
      field.element.hidden = scenario !== 'words';
    });
    render(clock.state.time);
  }
  function render(time) {
    if (!shapes || disposed) return;
    const t = time / clock.state.duration;
    const approach = smooth(0.08, 0.62, t);
    const a = -(shapes[0].bounds.width / 2 + 66) * (1 - approach);
    const b = (shapes[1].bounds.width / 2 + 66) * (1 - approach);
    view.render({
      sources: [
        { x: a, y: 0 },
        { x: b, y: 0 },
      ],
      target: { x: 0, y: 0 },
      tension,
      morph: smooth(0.68, 0.94, t),
    });
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
      words = model.texts.map((text) => text.slice(0, 32));
    if (Number.isFinite(model?.tension)) tension = Math.max(0, Math.min(64, model.tension));
    if (['words', 'letters', 'drops'].includes(model?.example)) scenario = model.example;
    clearTimeout(timer);
    timer = 0;
    clock.pause();
    fields.forEach((field, i) => field.setValue(words[i]));
    strength.setValue(tension);
    cases.setValue(scenario);
    rebuild();
    if (Number.isFinite(snapshot.privateContent?.time)) clock.seek(snapshot.privateContent.time);
    return true;
  }
  const controls = player(root.querySelector('.fusion-player'), {
    transport: clock,
    stops: [0, 3.5, 7.5, 12],
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
    seek: (time) => {
      clock.pause();
      clock.seek(time);
    },
    pause: clock.pause,
    review: () => ({ duration: 12, cues: [] }),
    snapshot: () => ({ texts: words, scenario, tension, time: clock.state.time }),
    dispose() {
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
    },
  };
  if (!restored && !reduced.matches) void clock.play();
})().catch((error) => {
  document.querySelector('.fusion-error').textContent = error.message;
  throw error;
});
