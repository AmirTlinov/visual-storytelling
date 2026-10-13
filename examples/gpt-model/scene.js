import { SceneShell, surface } from '@visual-storytelling/core';
import { MODEL, CONFIG, PRESETS, forward, rankingAt, gelu } from './model.js';
import { mountComputation } from './computation.js';
import { drawing } from './drawing.js';
import '@visual-storytelling/core/style.css';
import './style.css';

const views = [
  'overview',
  'embedding',
  'block',
  'attention',
  'scores',
  'projection',
  'norm',
  'residual',
  'mlp',
  'output',
  'logits',
  'merge',
  'model',
];
const names = {
  overview: 'Как GPT выбирает следующее слово',
  embedding: 'Слово становится вектором',
  block: 'Блок дописывает в поток',
  attention: 'Attention: собрать контекст',
  scores: 'Оценки превращаются в веса',
  projection: 'Откуда берутся Q, K и V',
  norm: 'LayerNorm: общий масштаб координат',
  residual: 'Residual stream: сохранить и дополнить',
  mlp: 'MLP: преобразовать каждый вектор',
  output: 'Выбрать следующее слово',
  logits: 'Как вектор оценивает слово',
  merge: 'Две головы → одна прибавка',
  model: 'Какая модель перед нами',
};
const starts = {
  overview: 0,
  embedding: 10,
  block: 22,
  attention: 32,
  scores: 36,
  projection: 34,
  norm: 24,
  residual: 56,
  mlp: 65,
  output: 82,
  logits: 82,
  merge: 40,
  model: 0,
};
const segments = [
  {
    id: 'overview',
    start: 0,
    end: 10,
    title: 'Продолжить фразу',
    text: 'У фразы пока нет продолжения. Проследим, как эта маленькая модель получает из слов числа и выбирает следующий токен.',
    hold: 'Проследить путь выбранной фразы через два блока к месту следующего слова.',
  },
  {
    id: 'embedding',
    start: 10,
    end: 22,
    title: 'Токен и позиция',
    text: 'Для каждого слова возьмём восемь чисел из обученной таблицы. Добавим числа его позиции: теперь вектор зависит и от слова, и от его места.',
    action: 'Появляются вектор выбранного токена, вектор его позиции и их покоординатная сумма.',
  },
  {
    id: 'block',
    start: 22,
    end: 32,
    title: 'Внутри блока',
    text: 'Этот вектор проходит через блок. Сначала к нему добавляются сведения из контекста, затем — результат преобразования самого вектора.',
    action:
      'На сквозном пути вектора последовательно раскрываются ветви attention и MLP с местами сложения.',
  },
  {
    id: 'attention',
    start: 32,
    end: 42,
    title: 'Собрать контекст',
    text: 'Посмотрим на первую прибавку. Выбранный токен получает взвешенную смесь значений доступных ему токенов. У каждой связи здесь свой вес.',
    hold: 'Сопоставить доступные токены, проценты на связях и место взвешенной суммы; будущие токены закрыты.',
  },
  {
    id: 'calculation',
    start: 42,
    end: 56,
    title: 'Посчитать сходство',
    text: 'Сначала посчитаем оценку одной связи. Перемножим парные координаты запроса и ключа, сложим вклады и разделим сумму на корень из размерности.',
    action:
      'Пары координат выбранных Q и K дают произведения, их сумма и масштабирование дают оценку связи.',
  },
  {
    id: 'residual',
    start: 56,
    end: 65,
    title: 'Прибавка к вектору',
    text: 'Собранный контекст вернётся в общий поток. Сравните три строки: исходный вектор, прибавку и их сумму.',
    hold: 'Сравнить согласованные координаты исходного вектора, результата attention и суммы.',
  },
  {
    id: 'mlp',
    start: 65,
    end: 74,
    title: 'Преобразовать вектор',
    text: 'Теперь каждый вектор преобразуется отдельно. Из восьми координат получаются тридцать две, нелинейная функция меняет их, и обратно возвращается прибавка из восьми чисел.',
    hold: 'Проследить размеры 8 → 32 → 8 и место нелинейного преобразования перед новой прибавкой.',
  },
  {
    id: 'prediction',
    start: 74,
    end: 82,
    title: 'Ваш прогноз',
    text: 'После двух блоков модель оценит возможные продолжения. Какое слово вы ожидаете увидеть? Выберите его и сравните с результатом.',
    hold: 'Выбрать продолжение показанного префикса до открытия вероятностей.',
    awaitInput: true,
  },
  {
    id: 'output',
    start: 82,
    end: 94,
    title: 'Следующий токен',
    text: 'Вот вероятности продолжений. Можно добавить самый вероятный токен к фразе: модель пройдёт тот же путь ещё раз, уже с новым контекстом.',
    action:
      'Открываются вероятности; по нажатию «Добавить» выбранный моделью токен возвращает изменённую фразу на общую схему.',
  },
];
const script = {
  duration: 94,
  cues: Object.fromEntries(
    segments.map(({ id, start, end, action, hold, awaitInput }) => [
      id,
      { start, end, ...(action ? { action } : { hold }), ...(awaitInput ? { awaitInput } : {}) },
    ]),
  ),
  segments: segments.map(({ id, start, end, title, text }) => ({ id, start, end, title, text })),
};
const defaults = {
  preset: 'cat-place',
  token: 3,
  source: 1,
  block: 0,
  head: 0,
  channel: 0,
  view: 'overview',
  perspective: 'diagram',
  kind: 'score',
  projection: 'q',
  phase: 0,
  guess: '',
  checked: false,
  generated: false,
  ablate: false,
  axis: 0,
  term: 0,
  normKind: 'ln1',
  detailPage: -1,
  candidate: -1,
};
const fmt = (v, digits = 2) =>
  (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : Number(v)).toFixed(digits).replace('-', '−');
const percent = (v) =>
  v < 0.0001 ? '<0,01%' : `${(v * 100).toFixed(v < 0.01 || v > 0.99 ? 2 : 1).replace('.', ',')}%`;
const tokenName = (token) => (token === '<начало>' ? 'начало' : token);
const options = (list) => list.map((value) => ({ value, label: String(value) }));
const parentView = (view) =>
  ['scores', 'projection', 'merge'].includes(view)
    ? 'attention'
    : view === 'logits'
      ? 'output'
      : ['attention', 'norm', 'residual', 'mlp'].includes(view)
        ? 'block'
        : 'overview';
const perspectives = (view) =>
  ['overview', 'embedding', 'output', 'model', 'norm', 'merge'].includes(view)
    ? ['diagram']
    : ['projection', 'logits'].includes(view)
      ? ['diagram', 'algebra']
      : ['diagram', 'algebra', 'geometry', 'hardware'];
const kindFor = (view, previous) =>
  view === 'logits'
    ? 'logit'
    : view === 'projection'
      ? 'projection'
      : view === 'mlp'
        ? 'mlp'
        : ['block', 'residual'].includes(view)
          ? 'residual'
          : view === 'attention' && previous === 'mix'
            ? 'mix'
            : 'score';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('gpt-model');
  const shell = SceneShell.mount(root, {
    title: 'Как GPT выбирает следующее слово',
    heading: false,
    navigation: false,
    exploration: 'view',
    parameters: [
      {
        key: 'preset',
        label: 'Фраза',
        type: 'select',
        value: defaults.preset,
        options: PRESETS.map((p) => ({ value: p.id, label: p.label })),
      },
      ...['token', 'source', 'channel'].map((key) => ({
        key,
        label: key,
        value: defaults[key],
        min: 0,
        max: 7,
        step: 1,
      })),
      ...['block', 'head'].map((key) => ({ key, label: key, value: 0, min: 0, max: 1, step: 1 })),
      { key: 'view', label: 'Уровень', type: 'select', value: 'overview', options: options(views) },
      {
        key: 'perspective',
        label: 'Точка зрения',
        type: 'select',
        value: 'diagram',
        options: options(['diagram', 'algebra', 'geometry', 'hardware']),
      },
      {
        key: 'kind',
        label: 'Вычисление',
        type: 'select',
        value: 'score',
        options: options(['score', 'mix', 'residual', 'mlp', 'projection', 'logit']),
      },
      {
        key: 'projection',
        label: 'Проекция attention',
        type: 'select',
        value: 'q',
        options: options(['q', 'k', 'v']),
      },
      {
        key: 'normKind',
        label: 'Нормализация',
        type: 'select',
        value: 'ln1',
        options: options(['ln1', 'ln2']),
      },
      { key: 'phase', label: 'Ход вычисления', value: 0, min: 0, max: 1, step: 0.01 },
      { key: 'axis', label: 'Плоскость координат', value: 0, min: 0, max: 6, step: 1 },
      { key: 'term', label: 'Слагаемое', value: 0, min: 0, max: 31, step: 1 },
      { key: 'detailPage', label: 'Страница подробностей', value: -1, min: -1, max: 8, step: 1 },
      {
        key: 'candidate',
        label: 'Выходной токен',
        value: -1,
        min: -1,
        max: MODEL.vocab.length - 1,
        step: 1,
      },
      {
        key: 'guess',
        label: 'Прогноз',
        type: 'select',
        value: '',
        options: options(['', ...MODEL.vocab]),
      },
      ...['checked', 'generated', 'ablate'].map((key) => ({
        key,
        label: key,
        type: 'toggle',
        value: false,
      })),
    ],
  });
  shell.showParameters([]);
  const paper = surface(shell.stage, {
    id: 'gpt-drawing',
    width: 1280,
    height: 720,
    title: 'Один токен проходит через GPT',
    description: 'Выберите токен или блок. Все числа вычисляются локальной учебной моделью.',
    grid: false,
  });
  Object.assign(paper.element.style, {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  });
  const mathHost = document.createElement('div');
  mathHost.className = 'gpt-computation';
  mathHost.hidden = true;
  shell.stage.append(mathHost);
  let computation,
    artwork,
    lastKey = '',
    controller,
    current,
    cachedInput = '',
    trace;
  const enter = (view, patch = {}) =>
    shell.input({ view, perspective: 'diagram', detailPage: -1, ...patch });
  const input = (patch) => shell.input(patch);
  const selectPreset = () => {
    const index = PRESETS.findIndex((p) => p.id === current.values.preset);
    input({ preset: PRESETS[(index + 1) % PRESETS.length].id });
  };
  const modelFor = (p) => {
    const preset = PRESETS.find((preset) => preset.id === p.preset);
    let tokens = preset.tokens;
    const intervention = p.ablate ? { ablateHead: { block: p.block, head: p.head } } : {};
    if (p.generated) tokens = [...tokens, forward(tokens, intervention).next.token];
    const key = JSON.stringify([tokens, p.ablate, p.block, p.head]);
    if (key !== cachedInput) {
      trace = forward(tokens, intervention);
      cachedInput = key;
    }
    return trace;
  };
  const stateAt = (frame) => {
    const kept = controller?.requested.values ?? defaults;
    const segment =
      segments.find(({ start, end }) => frame.time >= start && frame.time < end) ?? segments.at(-1);
    const id = segment.id;
    return {
      ...kept,
      view: id === 'calculation' ? 'attention' : id === 'prediction' ? 'output' : id,
      perspective: id === 'calculation' ? 'algebra' : 'diagram',
      kind: id === 'calculation' ? 'score' : kindFor(id, kept.kind),
      phase: id === 'calculation' ? (frame.time - 42) / 14 : 0,
      checked: frame.time >= 82,
      generated: false,
      detailPage: -1,
    };
  };
  controller = shell.attachStory({
    script,
    stateAt,
    canContinue: (_cue, moment) => moment.values.checked,
    resolveInput(patch, moment) {
      const p = { ...moment.values, ...patch };
      if (patch.view !== undefined && patch.detailPage === undefined) p.detailPage = -1;
      if (patch.preset !== undefined)
        Object.assign(p, {
          token: PRESETS.find((item) => item.id === patch.preset).tokens.length,
          source: 1,
          checked: moment.values.checked,
          guess: '',
          generated: false,
        });
      if (patch.ablate !== undefined)
        Object.assign(p, { checked: moment.values.checked, guess: '' });
      if (patch.token !== undefined || patch.generated !== undefined) p.guess = '';
      p.kind = kindFor(p.view, p.kind);
      if (!perspectives(p.view).includes(p.perspective)) {
        if (patch.perspective !== undefined)
          throw new Error(`View ${p.view} supports: ${perspectives(p.view).join(', ')}`);
        p.perspective = 'diagram';
      }
      let time = moment.time;
      if (patch.checked === true) time = 82;
      else if (patch.view !== undefined)
        time = patch.view === 'output' && !p.checked ? 74 : (starts[patch.view] ?? time);
      return { values: p, time };
    },
    derive(p) {
      const trace = modelFor(p);
      const token = Math.min(p.token, trace.tokens.length - 1),
        source = Math.min(p.source, trace.tokens.length - 1),
        block = trace.blocks[p.block],
        head = block.attention.heads[p.head];
      const ranking = rankingAt(trace, token);
      const candidate = p.candidate < 0 ? ranking[0].id : p.candidate;
      return { values: p, trace, token, source, block, head, ranking, candidate };
    },
    render(state, frame, mode) {
      current = state;
      const layout = shell.layout;
      const { width: W, height: H, compact, scale } = layout;
      if (!W || !H) return;
      paper.resize(W, H, false);
      const p = state.values;
      const isMath =
        p.detailPage < 0 &&
        p.perspective === 'algebra' &&
        !['overview', 'embedding', 'output', 'model', 'norm', 'merge'].includes(p.view);
      const key = JSON.stringify([{ ...p, phase: undefined }, state.token, W, H, scale, isMath]);
      if (key !== lastKey) {
        lastKey = key;
        const active = document.activeElement?.dataset.action;
        artwork?.dispose();
        artwork = drawing(paper, layout, input);
        const d = artwork;
        const margin = compact ? 24 : 40,
          top = compact ? 100 : 90;
        const short = {
          overview: 'Как GPT продолжает фразу',
          embedding: 'Токен → 8 чисел',
          block: `Блок ${p.block + 1}`,
          attention: 'Собрать контекст',
          scores: 'От оценки к весу',
          projection: `${p.projection.toUpperCase()}: обученная проекция`,
          norm: 'Нормализация',
          residual: 'Сохранить и дополнить',
          mlp: 'Преобразовать вектор',
          output: 'Следующее слово',
          logits: `Оценка слова «${tokenName(MODEL.vocab[state.candidate])}»`,
          merge: 'Две головы → один вектор',
          model: 'Учебная GPT',
        };
        d.text(compact ? short[p.view] : names[p.view], margin, compact ? 65 : 49, {
          size: compact ? d.size * 1.12 : 37,
          handwriting: 'heading',
        });
        if (!compact) {
          d.button('about', '2 блока · 8 каналов', W - 300, 13, 265, () => enter('model'), {
            outline: false,
            height: 44,
          });
          if (p.view !== 'overview')
            d.button(
              'back',
              p.perspective !== 'diagram'
                ? '← Схема'
                : p.view === 'logits'
                  ? '← Вероятности'
                  : parentView(p.view) === 'attention'
                    ? '← Attention'
                    : parentView(p.view) === 'block'
                      ? '← К блоку'
                      : '← Вся модель',
              margin,
              66,
              205,
              () =>
                p.perspective !== 'diagram'
                  ? input({ perspective: 'diagram' })
                  : enter(parentView(p.view)),
              { outline: false, height: 42 },
            );
          if (p.view !== 'overview' && p.view !== 'model')
            d.text(
              `токен «${tokenName(state.trace.tokens[state.token])}» · позиция ${state.token}`,
              margin + 240,
              94,
              { pigment: 'muted', size: 24 },
            );
        }
        mathHost.hidden = !isMath;
        if (compact && p.detailPage >= 0) drawDetails(d, state);
        else if (isMath) {
          const y = compact ? 110 : 153,
            bottom = compact ? d.hit + 26 : 135;
          Object.assign(mathHost.style, {
            left: `${margin}px`,
            top: `${y}px`,
            width: `${W - 2 * margin}px`,
            height: `${H - y - bottom}px`,
          });
          const equations = {
            score: 'q · k / √4',
            mix: 'Σ вес × значение',
            residual: 'x + attention(x)',
            mlp: 'Σ GELU(h) × w + b',
            projection: `LN(x) · w${p.projection.toUpperCase()} + b`,
            logit: 'LN(x) · embedding слова → оценка',
          };
          if (!compact)
            d.text(equations[p.kind], W / 2, 139, {
              anchor: 'middle',
              size: 30,
              pigment: 'purple',
            });
          if (!compact) {
            d.button('math-rewind', 'Начало', margin, d.detailActionY, 150, () =>
              input({ phase: 0 }),
            );
            d.button('math-step', 'Следующий шаг →', margin + 175, d.detailActionY, 270, () =>
              input({
                phase: computation.nextProgress(),
              }),
            );
          }
        } else if (p.perspective === 'geometry') drawGeometry(d, state, top);
        else if (p.perspective === 'hardware') drawHardware(d, state, top);
        else
          ({
            overview: drawOverview,
            embedding: drawEmbedding,
            block: drawBlock,
            attention: drawAttention,
            scores: drawScores,
            projection: drawProjection,
            norm: drawNorm,
            residual: drawResidual,
            mlp: drawMLP,
            output: drawOutput,
            logits: drawLogits,
            merge: drawMerge,
            model: drawModel,
          })[p.view](d, state, top);
        if (compact && p.detailPage < 0) {
          if (p.view !== 'overview')
            d.button('back', '←', margin, H - d.hit - 10, d.hit, () =>
              p.perspective !== 'diagram'
                ? input({ perspective: 'diagram' })
                : enter(parentView(p.view)),
            );
          if (isMath) {
            d.button('math-step', 'Шаг →', margin + d.hit + 20, H - d.hit - 10, 400, () =>
              input({
                phase: computation.nextProgress(),
              }),
            );
            d.button(
              'perspective-next',
              ['projection', 'logits'].includes(p.view) ? 'Схема →' : 'Геометрия →',
              margin + d.hit + 440,
              H - d.hit - 10,
              W - 2 * margin - d.hit - 440,
              () =>
                input({
                  perspective: ['projection', 'logits'].includes(p.view) ? 'diagram' : 'geometry',
                }),
            );
          } else if (
            ![
              'overview',
              'output',
              'model',
              'norm',
              'projection',
              'embedding',
              'logits',
              'merge',
            ].includes(p.view)
          ) {
            const order = ['diagram', 'algebra', 'geometry', 'hardware'];
            const next = order[(order.indexOf(p.perspective) + 1) % order.length];
            d.button(
              'perspective-next',
              {
                diagram: 'Схема',
                algebra: 'Посчитать →',
                geometry: 'Геометрия →',
                hardware: 'Электроника →',
              }[next],
              margin + d.hit + 400,
              H - d.hit - 10,
              W - 2 * margin - d.hit - 400,
              () =>
                input({
                  perspective: next,
                  kind: kindFor(p.view, p.kind),
                  phase: 0,
                }),
            );
          }
          if (!isMath && p.view !== 'overview' && (p.view !== 'output' || p.checked))
            d.button('details', 'Детали', margin + d.hit + 20, H - d.hit - 10, 350, () =>
              input({ detailPage: 0 }),
            );
        } else if (
          !compact &&
          ![
            'overview',
            'model',
            'output',
            'embedding',
            'norm',
            'projection',
            'logits',
            'merge',
          ].includes(p.view)
        ) {
          const items = [
            ['diagram', 'Схема'],
            ['algebra', 'Алгебра'],
            ['geometry', 'Геометрия'],
            ['hardware', 'Электроника'],
          ];
          items.forEach(([id, label], i) =>
            d.button(
              `perspective-${id}`,
              label,
              260 + i * 205,
              H - d.hit - 10,
              185,
              () =>
                input({
                  perspective: id,
                  kind: kindFor(p.view, p.kind),
                  phase: 0,
                }),
              { pressed: p.perspective === id, height: 44 },
            ),
          );
        }
        d.settle();
        if (active)
          paper.element.querySelector(`[data-action="${active}"]`)?.focus({ preventScroll: true });
      }
      artwork.render(frame, mode);
      if (isMath) {
        if (!computation) {
          computation = mountComputation(mathHost);
          shell.attachView(computation.view);
        }
        computation.setActive(true);
        computation.render({
          trace: state.trace,
          block: p.block,
          token: state.token,
          head: p.head,
          source: state.source,
          channel: p.channel,
          kind: p.kind,
          projection: p.projection,
          progress: p.phase,
          reduced: frame.reduced,
          compact,
          candidate: state.candidate,
        });
      } else computation?.setActive(false);
    },
  });
  shell.onDispose(() => {
    artwork?.dispose();
    paper.dispose();
  });
  root.scene.extend({
    snapshot: () => ({
      ...current.values,
      token: current.token,
      source: current.source,
      trace: current.trace,
      candidate: current.candidate,
      waiting: controller.waiting,
    }),
    checkpoints: [0, 15, 25, 36, 47, 56, 68, 74, 85],
  });
  await controller.ready();

  function tokens(d, s, y, full = true) {
    const shown = d.compact ? s.trace.tokens.slice(1) : s.trace.tokens;
    const gap = d.compact ? 20 : 14,
      width = Math.min(
        d.compact ? 330 : 155,
        (d.width - 80 - (shown.length - 1) * gap) / shown.length,
      );
    const start = (d.width - shown.length * width - (shown.length - 1) * gap) / 2;
    shown.forEach((word, i) => {
      const index = d.compact ? i + 1 : i;
      d.button(
        `token-${index}`,
        tokenName(word),
        start + i * (width + gap),
        y,
        width,
        () => input({ token: index }),
        {
          pressed: s.token === index,
          height: d.hit,
          pigment: s.token === index ? 'purple' : 'ink',
        },
      );
    });
    if (!d.compact && full)
      d.text('Каждый токен несёт свой вектор. Выберите любой.', d.width / 2, y + d.hit + 34, {
        anchor: 'middle',
        pigment: 'muted',
        size: 23,
      });
  }
  function vector(
    d,
    values,
    x,
    y,
    w,
    {
      label,
      id = `${current.values.view}:${label ?? 'vector'}`,
      pigment = 'ink',
      numbers = true,
      source,
      row = current.token,
      offset = 0,
    } = {},
  ) {
    if (label) d.text(label, x, y - 18, { pigment, size: d.size });
    const gap = 5,
      cell = (w - gap * (values.length - 1)) / values.length;
    values.forEach((v, i) => {
      const g = d.box(
        `vector-${label}-${x}-${y}-${i}`,
        x + i * (cell + gap),
        y,
        cell,
        Math.max(cell, d.compact ? 85 : 55),
        pigment,
        'marker',
      );
      g.element.style.setProperty(
        '--ve-wash-strength',
        `${15 + 55 * Math.min(1, Math.abs(v) / 4)}%`,
      );
      d.explain(g.element, `${id}:cell:${i}`, {
        label: `${label ?? 'Вектор'}: координата ${i + 1}`,
        value: () => v,
        implementation: { file: 'model.js' },
        provenance: () =>
          source
            ? { source: { path: source, coordinates: [row, i + offset] }, precision: 'exact' }
            : undefined,
      });
      if (numbers && !d.compact)
        d.text(fmt(v, 1), x + i * (cell + gap) + cell / 2, y + 33, {
          anchor: 'middle',
          size: Math.max(20, d.size),
          pigment,
        });
    });
  }
  function drawDetails(d, s) {
    const p = s.values;
    const item = (label, patch) => ({ label, patch });
    const short = {
      overview: 'Вся модель',
      embedding: 'Токен + позиция',
      block: 'Блок GPT',
      attention: 'Attention',
      scores: 'Оценки → веса',
      projection: 'Q, K и V',
      norm: 'LayerNorm',
      residual: 'Residual stream',
      mlp: 'MLP',
      output: 'Следующее слово',
      logits: 'Оценка слова',
      merge: 'Объединить головы',
      model: 'Устройство модели',
    };
    const open = (view, patch = {}) =>
      item(short[view], { view, perspective: 'diagram', ...patch });
    const context = [
      item(`Токен: ${tokenName(s.trace.tokens[s.token])} →`, {
        token: (s.token + 1) % s.trace.tokens.length,
      }),
      item(`Источник: ${tokenName(s.trace.tokens[s.source])} →`, {
        source: (s.source + 1) % s.trace.tokens.length,
      }),
      item(`Голова ${p.head + 1} →`, { head: 1 - p.head }),
      item(p.ablate ? 'Вернуть голову' : 'Отключить голову', { ablate: !p.ablate }),
    ];
    const items = {
      overview: [
        open('embedding'),
        open('model'),
        item('Изменить фразу', {
          preset: PRESETS[(PRESETS.findIndex((v) => v.id === p.preset) + 1) % PRESETS.length].id,
        }),
        open('output'),
      ],
      embedding: [
        item('«на»: другая позиция', {
          preset: p.preset === 'position' ? 'cat-place' : 'position',
        }),
        open('overview'),
        open('model'),
      ],
      block: [
        open('attention'),
        open('mlp'),
        open('residual'),
        item(`Блок ${p.block + 1} →`, { block: 1 - p.block }),
        item('LN до attention', { view: 'norm', normKind: 'ln1' }),
        item('LN до MLP', { view: 'norm', normKind: 'ln2' }),
      ],
      attention: [
        open('scores'),
        open('projection'),
        item('Сумма вес × V', { perspective: 'algebra', kind: 'mix', phase: 0 }),
        open('merge'),
        ...context,
      ],
      scores: [open('projection'), open('attention'), ...context],
      projection: [
        ...['q', 'k', 'v'].map((projection) =>
          item(`Проекция ${projection.toUpperCase()}`, { projection }),
        ),
        item(`Координата ${(p.channel % 4) + 1} →`, { channel: (p.channel + 1) % 4 }),
        ...context,
      ],
      residual: [
        item(`Координата ${p.channel + 1} →`, { channel: (p.channel + 1) % 8 }),
        item(`Плоскость ${p.axis + 1}, ${p.axis + 2} →`, { axis: (p.axis + 2) % 7 }),
        open('merge'),
        open('block'),
      ],
      mlp: [
        item(`Нейрон ${p.term + 1} →`, { term: (p.term + 1) % 32, perspective: 'geometry' }),
        item(`Выход ${p.channel + 1} →`, { channel: (p.channel + 1) % 8 }),
        open('norm', { normKind: 'ln2' }),
        open('block'),
      ],
      output: [
        open('logits'),
        item('Изменить фразу', {
          preset: PRESETS[(PRESETS.findIndex((v) => v.id === p.preset) + 1) % PRESETS.length].id,
        }),
        ...context.slice(0, 1),
      ],
      logits: [
        item('Посчитать оценку', { perspective: 'algebra', phase: 0 }),
        ...s.ranking
          .slice(0, 3)
          .map((r) => item(`Слово «${tokenName(r.token)}»`, { candidate: r.id })),
      ],
      norm: [
        item('LN до attention', { normKind: 'ln1' }),
        item('LN до MLP', { normKind: 'ln2' }),
        open('block'),
      ],
      merge: [open('attention'), open('residual'), ...context.slice(2)],
      model: [open('overview'), open('embedding')],
    }[p.view];
    const margin = 35,
      gap = 24,
      available = d.width - 2 * margin;
    const measured = items.map((entry, index) => ({
      ...entry,
      index,
      ...d.buttonSize(entry.label),
    }));
    const rows = [];
    for (let index = 0; index < measured.length; ) {
      const first = measured[index++],
        second = measured[index];
      // The complete lettering participates in layout before any hit target is placed.
      const pair = second && first.width + gap + second.width <= available;
      rows.push(pair ? [first, measured[index++]] : [first]);
    }
    const pages = Math.ceil(rows.length / 2),
      page = Math.min(p.detailPage, pages - 1);
    let y = 140;
    for (const row of rows.slice(page * 2, page * 2 + 2)) {
      const extra =
        (available - gap * (row.length - 1) - row.reduce((sum, entry) => sum + entry.width, 0)) /
        row.length;
      const height = Math.max(...row.map((entry) => entry.height));
      let x = margin;
      for (const entry of row) {
        const width = entry.width + extra;
        d.button(
          `detail-${entry.index}`,
          entry.label,
          x,
          y,
          width,
          () => input({ ...entry.patch, detailPage: -1 }),
          { height },
        );
        x += width + gap;
      }
      y += height + gap;
    }
    d.button('details-back', '←', 24, d.height - d.hit - 10, d.hit, () =>
      input({ detailPage: -1 }),
    );
    if (pages > 1)
      d.button(
        'details-next',
        `Ещё · ${page + 1}/${pages} →`,
        300,
        d.height - d.hit - 10,
        940,
        () => input({ detailPage: (page + 1) % pages }),
      );
  }
  function drawOverview(d, s) {
    const p = s.values;
    if (d.compact) {
      tokens(d, s, 110, false);
      d.line([d.width / 2, 110 + d.hit + 16], [d.width / 2, d.detailActionY - 8], 'ink', true, 3);
      d.button(
        'enter-block',
        '2 блока GPT',
        230,
        d.detailActionY,
        d.width - 460,
        () => enter('block'),
        {
          height: d.hit,
          pigment: 'purple',
        },
      );
      d.button('details', 'Детали модели', 32, d.height - d.hit - 10, 610, () =>
        input({ detailPage: 0 }),
      );
      d.button('next-token', 'Результат →', 665, d.height - d.hit - 10, d.width - 697, () =>
        enter('output'),
      );
      return;
    }
    d.text('Контекст меняется. Операции и обученные веса остаются.', 40, 100, {
      size: 25,
      pigment: 'muted',
    });
    tokens(d, s, 135);
    const y = 345;
    const blocks = [
      ['embedding', 'Токен + позиция', 60, 220],
      ['block', 'Блок 1', 365, 175],
      ['block', 'Блок 2', 640, 175],
      ['output', 'Следующее слово', 930, 235],
    ];
    const nodes = blocks.map(([view, label, x, w], i) => {
      const node = d.button(
        `node-${i}`,
        label,
        x,
        y - 34,
        w,
        () => enter(view, { block: i === 2 ? 1 : 0 }),
        {
          height: 68,
          pigment: i === 0 || i === 3 ? 'ink' : 'purple',
        },
      );
      if (i === 1 || i === 2) {
        const b = s.trace.blocks[i - 1];
        vector(d, b.output[s.token], x - 14, y + 74, w + 28, {
          id: `overview:block:${i}`,
          source: `blocks.${i - 1}.output`,
          pigment: 'purple',
          numbers: false,
        });
      }
      return node.bounds;
    });
    nodes.slice(1).forEach((next, i) => {
      const previous = nodes[i];
      d.line([previous.x + previous.width + 8, y], [next.x - 8, y], 'purple', true, 5);
    });
    d.annotation(
      'residual-stream',
      'residual stream — вектор, который дополняют блоки',
      323,
      260,
      'purple',
      3,
    );
    d.text('слово → числа', 94, 453, { pigment: 'muted', size: 24 });
    d.text(p.checked ? s.ranking[0].token : '?', 1038, 464, {
      anchor: 'middle',
      size: 57,
      handwriting: 'heading',
    });
    d.button('change-prompt', 'Другая фраза →', 55, 555, 265, selectPreset);
    d.button('enter-model', 'Что обучалось?', 950, 555, 230, () => enter('model'));
  }
  function drawEmbedding(d, s) {
    if (d.compact) {
      d.text(`«${tokenName(s.trace.tokens[s.token])}» + позиция ${s.token}`, d.width / 2, 190, {
        anchor: 'middle',
      });
      vector(d, s.trace.embedding.residual[s.token], 70, 270, d.width - 140, {
        source: 'embedding.residual',
        pigment: 'purple',
        numbers: false,
      });
      d.text('8 координат одного токена', d.width / 2, 440, { anchor: 'middle' });
      return;
    }
    const x = 285,
      w = 795;
    d.sequence('token-embedding', 10, 12, () =>
      vector(d, s.trace.embedding.token[s.token], x, 210, w, {
        label: `Таблица слова «${tokenName(s.trace.tokens[s.token])}»`,
        id: 'embedding:token',
        source: 'weights.tokenEmbedding',
        row: s.trace.ids[s.token],
      }),
    );
    d.sequence('position-embedding', 14, 16, () => {
      d.text('+', x - 75, 332, { size: 50 });
      vector(d, s.trace.embedding.position[s.token], x, 305, w, {
        label: `Таблица позиции ${s.token}`,
        id: 'embedding:position',
        source: 'weights.positionEmbedding',
        pigment: 'orange',
      });
    });
    d.sequence('embedding-sum', 18, 20, () => {
      d.line([x - 20, 408], [x + w + 20, 408], 'muted');
      vector(d, s.trace.embedding.residual[s.token], x, 450, w, {
        label: 'Начало residual stream',
        id: 'embedding:sum',
        source: 'embedding.residual',
        pigment: 'purple',
      });
    });
    d.button('change-position', '«на»: другая позиция →', 55, 550, 345, () =>
      input({ preset: s.values.preset === 'position' ? 'cat-place' : 'position' }),
    );
    d.note('Одинаковое слово получает другую добавку в другом месте фразы.', 420, 582, 660, {
      size: 26,
    });
  }
  function drawBlock(d, s) {
    if (d.compact) {
      d.button('attention', 'Attention', 75, 140, 470, () => enter('attention'), {
        pigment: 'orange',
      });
      d.button('mlp', 'MLP', 735, 140, 470, () => enter('mlp'), { pigment: 'green' });
      d.line([120, 430], [1150, 430], 'purple', true, 5);
      d.line([310, 300], [310, 430], 'orange', true);
      d.line([970, 300], [970, 430], 'green', true);
      d.text('x', 80, 402);
      d.text('+', 282, 464);
      d.text('+', 941, 464);
      return;
    }
    const y = 455;
    [
      [90, 357],
      [419, 857],
      [919, 1170],
    ].forEach(([a, b]) => d.line([a, y], [b, y], 'purple', true, 5));
    for (const [name, title, x, pigment, from, to] of [
      ['attention', 'Attention', 280, 'orange', 24, 26],
      ['mlp', 'MLP', 780, 'green', 28, 30],
    ]) {
      d.sequence(`block-${name}`, from, to, () => {
        d.line([x - 105, y], [x - 105, 336], 'muted', true);
        d.line([x - 105, 279], [x - 105, 255], 'muted');
        d.button(
          `${name}-norm`,
          'LN',
          x - 142,
          280,
          74,
          () => enter('norm', { normKind: name === 'attention' ? 'ln1' : 'ln2' }),
          { height: 52, pigment: 'muted' },
        );
        d.line([x - 105, 255], [x, 255], pigment, true);
        d.button(name, title, x, 215, 215, () => enter(name), { height: 80, pigment });
        d.line([x + 108, 295], [x + 108, y - 28], pigment, true, 3);
        d.box(`${name}-sum`, x + 82, y - 26, 52, 52, 'purple');
        d.text('+', x + 108, y + 12, { anchor: 'middle', size: 42 });
      });
    }
    d.text('x', 62, y + 14, { size: 39, pigment: 'purple' });
    d.annotation('attention-local', 'Собрать сведения из прошлых токенов', 156, 155, 'orange');
    d.annotation('mlp-local', 'Преобразовать каждый вектор отдельно', 735, 155, 'green');
    d.button('next-block', `Блок ${s.values.block + 1} из 2 →`, 55, d.detailActionY, 235, () =>
      input({ block: 1 - s.values.block }),
    );
    d.button('residual', 'Проследить прибавку →', 730, d.detailActionY, 355, () =>
      enter('residual'),
    );
  }
  function drawAttention(d, s) {
    const p = s.values,
      weights = s.head.probabilities[s.token];
    if (d.compact) {
      const order = weights
        .map((v, i) => ({ v, i }))
        .filter((x) => x.i <= s.token)
        .sort((a, b) => b.v - a.v)
        .slice(0, 2);
      order.forEach(({ v, i }, row) => {
        const y = 160 + row * 178;
        d.button(
          `source-${i}`,
          tokenName(s.trace.tokens[i]),
          50,
          y,
          405,
          () => input({ source: i }),
          { pressed: s.source === i, pigment: 'orange' },
        );
        d.line([495, y + 70], [820, y + 70], 'orange', true, 2 + v * 10);
        d.text(percent(v), 855, y + 88, { pigment: 'orange' });
      });
      return;
    }
    tokens(d, s, 132, false);
    const target = [905, 425];
    weights.forEach((weight, i) => {
      const x = 80 + i * 174;
      d.button(
        `source-${i}`,
        tokenName(s.trace.tokens[i]),
        x,
        295,
        150,
        () => input({ source: i }),
        { pressed: s.source === i, pigment: i > s.token ? 'muted' : 'orange' },
      );
      if (i <= s.token) {
        d.line([x + 75, 350], [target[0] + 100, target[1]], 'orange', true, 1.5 + weight * 5);
        d.text(percent(weight), x + 75, 280, { anchor: 'middle', pigment: 'orange', size: 23 });
      } else d.text('закрыто', x + 75, 280, { anchor: 'middle', pigment: 'muted', size: 23 });
    });
    d.button(
      'mix-calculation',
      'Взвешенная сумма V',
      target[0] - 180,
      target[1],
      360,
      () => input({ perspective: 'algebra', kind: 'mix', phase: 0 }),
      { pigment: 'orange', height: 65 },
    );
    d.text(`Голова ${p.head + 1} · токен «${tokenName(s.trace.tokens[s.token])}»`, 50, 251, {
      size: 28,
    });
    d.button('other-head', 'Другая голова', 55, d.detailActionY, 250, () =>
      input({ head: 1 - p.head }),
    );
    d.button('score-calculation', 'Откуда вес?', 337, d.detailActionY, 235, () => enter('scores'));
    d.button('projection', 'Q, K, V →', 596, d.detailActionY, 190, () => enter('projection'));
    d.button(
      'ablate-head',
      p.ablate ? 'Вернуть голову' : 'Отключить голову',
      824,
      d.detailActionY,
      325,
      () => input({ ablate: !p.ablate }),
      { pressed: p.ablate },
    );
  }
  function drawResidual(d, s) {
    const x = d.compact ? 285 : 300,
      width = d.width - x - (d.compact ? 55 : 90);
    const rows = [
      [s.block.input[s.token], 'x до attention', 'purple'],
      [s.block.attention.projected[s.token], 'прибавка Δ', 'orange'],
      [s.block.afterAttention[s.token], 'x + Δ', 'purple'],
    ];
    rows.forEach(([values, label, pigment], i) => {
      const y = d.compact ? 140 + i * 145 : 185 + i * 118;
      if (!d.compact) d.text(i === 1 ? '+' : i === 2 ? '=' : '', 180, y + 40, { size: 40 });
      else d.text(['x', 'Δ', 'x + Δ'][i], 45, y + 72);
      vector(d, values, x, y, width, {
        label: d.compact ? undefined : label,
        id: `residual:row:${i}`,
        source: `blocks.${s.values.block}.${['input', 'attention.projected', 'afterAttention'][i]}`,
        pigment,
        numbers: !d.compact,
      });
    });
    if (!d.compact) {
      d.text('Исходный вектор не стирается: результат блока прибавляется к нему.', 130, 586, {
        size: 28,
      });
      d.button('residual-math', 'Посмотреть сложение', 850, 105, 340, () =>
        input({ perspective: 'algebra', kind: 'residual', phase: 0 }),
      );
    }
  }
  function drawMLP(d, s) {
    if (d.compact) {
      d.text('8 → 32 → 8 координат', d.width / 2, 183, { anchor: 'middle' });
      d.line([120, 340], [1100, 340], 'green', true, 3);
      d.button('gelu', 'GELU', 130, 280, 420, () => input({ perspective: 'geometry' }), {
        pigment: 'green',
      });
      d.button('channel', `Канал ${s.values.channel + 1} →`, 720, 280, 490, () =>
        input({ channel: (s.values.channel + 1) % 8 }),
      );
      return;
    }
    const selected = s.values.channel;
    vector(d, s.block.ln2.output[s.token], 55, 225, 520, {
      label: 'LN(x)',
      numbers: true,
      source: `blocks.${s.values.block}.ln2.output`,
    });
    d.line([590, 260], [680, 260], 'green', true);
    const pre = s.block.mlp.preactivation[s.token],
      activation = s.block.mlp.activation[s.token];
    d.text('32 промежуточных значения', 704, 167, { pigment: 'green', size: 29 });
    pre.forEach((v, i) => {
      const x = 710 + (i % 8) * 57,
        y = 201 + Math.floor(i / 8) * 49;
      const g = d.box(
        `neuron-${i}`,
        x,
        y,
        44,
        36,
        activation[i] >= 0 ? 'green' : 'orange',
        'marker',
      );
      g.element.style.opacity = String(0.25 + 0.75 * Math.min(1, Math.abs(activation[i]) / 3));
    });
    d.text('xW₁ + b₁ → GELU', 185, 350, { size: 30, pigment: 'green' });
    d.line([950, 418], [950, 477], 'green', true);
    vector(d, s.block.mlp.output[s.token], 450, 498, 700, {
      label: 'GELU(h)W₂ + b₂ → прибавка в поток',
      source: `blocks.${s.values.block}.mlp.output`,
      pigment: 'green',
    });
    d.button('channel', `Канал ${selected + 1} →`, 55, d.detailActionY - d.hit - 18, 270, () =>
      input({ channel: (selected + 1) % 8 }),
    );
    d.button('mlp-channel', 'Вычислить координату →', 55, d.detailActionY, 365, () =>
      input({ perspective: 'algebra', kind: 'mlp', phase: 0 }),
    );
  }
  function predictionChoices(s) {
    const preset = PRESETS.find((item) => item.id === s.values.preset);
    if (s.token === s.trace.tokens.length - 1 && !s.values.generated)
      return preset.id.includes('sound') ? ['гав', 'мяу', 'чирик'] : ['ковре', 'ветке', 'полу'];
    return s.ranking
      .slice(0, 3)
      .map((item) => item.token)
      .sort();
  }
  function drawOutput(d, s) {
    const p = s.values,
      ranking = s.ranking.slice(0, d.compact ? 2 : 4);
    if (p.guess && !ranking.some((item) => item.token === p.guess))
      ranking[ranking.length - 1] = s.ranking.find((item) => item.token === p.guess);
    if (!p.checked) {
      d.text(
        d.compact
          ? 'Чем продолжится фраза?'
          : `«${s.trace.tokens.slice(1, s.token + 1).join(' ')} …»`,
        d.width / 2,
        d.compact ? 166 : 232,
        { anchor: 'middle', size: d.compact ? d.size : 42 },
      );
      const choices = predictionChoices(s);
      choices.forEach((word, i) =>
        d.button(
          `guess-${word}`,
          word,
          d.compact ? 30 + i * 415 : 225 + i * 285,
          d.compact ? 252 : 324,
          d.compact ? 390 : 235,
          () => input({ guess: word }),
          { pressed: p.guess === word },
        ),
      );
      if (p.guess)
        d.button(
          'check-prediction',
          'Проверить →',
          d.compact ? 220 : 480,
          d.compact ? d.height - d.hit - 10 : 469,
          d.compact ? d.width - 260 : 310,
          () => input({ checked: true }),
        );
      return;
    }
    ranking.forEach((item, i) => {
      const y = (d.compact ? 162 : 203) + i * (d.compact ? 185 : 91);
      const token = item.token ?? MODEL.vocab[item.id];
      const probability = item.probability;
      d.button(
        `output-word-${item.id}`,
        `${tokenName(token)} →`,
        d.compact ? 38 : 145,
        y - d.hit / 2,
        d.compact ? 390 : 215,
        () => enter('logits', { candidate: item.id }),
        { pigment: i === 0 ? 'green' : 'ink', outline: false },
      );
      if (p.guess === token)
        d.text('ваш выбор', d.compact ? 60 : 40, y + (d.compact ? 65 : 32), { pigment: 'muted' });
      const x = d.compact ? 500 : 390,
        w = d.compact ? 380 : 500;
      d.probability(`prob-${item.id}`, probability, x, y - 30, w, 38, {
        label: `Вероятность токена ${tokenName(token)}`,
        value: () => probability,
        unit: '1',
        provenance: () => ({
          token: s.token,
          candidate: item.id,
          logit: item.logit,
          model: MODEL.format,
        }),
        interactive: false,
      });
    });
    if (d.compact)
      d.button(
        'generate',
        p.generated
          ? 'Вернуть ↶'
          : s.token === s.trace.tokens.length - 1
            ? 'Добавить →'
            : 'К концу →',
        625,
        d.height - d.hit - 10,
        d.width - 665,
        () =>
          s.token !== s.trace.tokens.length - 1
            ? input({ token: s.trace.tokens.length - 1 })
            : input({
                generated: !p.generated,
                token:
                  PRESETS.find((item) => item.id === p.preset).tokens.length +
                  (p.generated ? 0 : 1),
                view: 'overview',
              }),
      );
    if (!d.compact) {
      d.text('logits → softmax → распределение', 390, 142, { size: 28, pigment: 'muted' });
      d.text('Выбираем наибольшую вероятность.', 160, 548, { size: 25, pigment: 'muted' });
      d.button(
        'generate',
        p.generated
          ? 'Исходная фраза ↶'
          : s.token === s.trace.tokens.length - 1
            ? `Добавить «${s.trace.next.token}» →`
            : 'К последнему токену →',
        850,
        d.height - d.hit - 30,
        335,
        () =>
          s.token !== s.trace.tokens.length - 1
            ? input({ token: s.trace.tokens.length - 1 })
            : input({
                generated: !p.generated,
                token:
                  PRESETS.find((item) => item.id === p.preset).tokens.length +
                  (p.generated ? 0 : 1),
                view: 'overview',
              }),
        { pressed: p.generated },
      );
      d.button('change-prompt', 'Другая фраза', 160, d.height - d.hit - 30, 300, selectPreset);
    }
  }
  function drawLogits(d, s) {
    const candidate = s.candidate,
      word = tokenName(MODEL.vocab[candidate]);
    const vectorRow = s.trace.finalNorm.output[s.token],
      embedding = MODEL.weights.tokenEmbedding[candidate];
    const normalized = s.trace.normalization[s.token],
      score = normalized.scores[candidate];
    if (d.compact) {
      d.text(`Вектор · веса слова «${word}»`, d.width / 2, 177, { anchor: 'middle' });
      d.text(`оценка = ${fmt(score, 3)}`, d.width / 2, 283, { anchor: 'middle', pigment: 'green' });
      d.button('logit-math', 'Раскрыть 8 произведений →', 40, d.detailActionY, d.width - 80, () =>
        input({ perspective: 'algebra', kind: 'logit', phase: 0 }),
      );
      return;
    }
    vector(d, vectorRow, 245, 184, 865, {
      label: 'Итог после двух блоков и final LayerNorm',
      id: 'logits:normalized',
      source: 'finalNorm.output',
      pigment: 'purple',
    });
    vector(d, embedding, 245, 337, 865, {
      label: `Обученный вектор слова «${word}»`,
      id: 'logits:weights',
      source: 'weights.tokenEmbedding',
      row: candidate,
      pigment: 'green',
    });
    d.text('·', 166, 318, { size: 72 });
    d.text(`оценка = ${fmt(score, 3)}`, 78, 491, { size: 32, pigment: 'green' });
    d.text(
      `exp(${fmt(score, 2)} − max) / Σexp = ${percent(normalized.probabilities[candidate])}`,
      455,
      491,
      {
        size: 28,
      },
    );
    d.text('Те же веса, что при входе слова. Нормируем оценки всех 17 слов.', 78, 546, {
      pigment: 'muted',
      size: 25,
    });
    d.button('logit-math', 'Раскрыть 8 произведений →', 78, 585, 455, () =>
      input({ perspective: 'algebra', kind: 'logit', phase: 0 }),
    );
    d.button('logit-candidate', `Слово «${word}» →`, 735, 585, 420, () =>
      input({ candidate: (candidate + 1) % MODEL.vocab.length }),
    );
  }
  function drawMerge(d, s) {
    const concat = s.block.attention.concat[s.token],
      projected = s.block.attention.projected[s.token];
    if (d.compact) {
      d.text('2 головы × 4 числа → 8 чисел', d.width / 2, 172, { anchor: 'middle' });
      vector(d, concat, 90, 238, d.width - 180, {
        id: 'merge:concat',
        source: `blocks.${s.values.block}.attention.concat`,
        pigment: 'orange',
        numbers: false,
      });
      d.text('Затем Wₒ + bₒ → прибавка к потоку', d.width / 2, 443, { anchor: 'middle' });
      return;
    }
    [0, 1].forEach((head) => {
      vector(d, concat.slice(head * 4, head * 4 + 4), 95 + head * 600, 215, 430, {
        label: `Голова ${head + 1}`,
        id: `merge:head:${head}`,
        source: `blocks.${s.values.block}.attention.concat`,
        offset: head * 4,
        pigment: 'orange',
      });
      d.line([310 + head * 600, 333], [475 + head * 290, 382], 'orange', true, 3);
    });
    d.text('Соединить 4 + 4 → 8, затем × Wₒ + bₒ', 635, 414, { anchor: 'middle', size: 33 });
    vector(d, projected, 190, 491, 910, {
      label: 'Прибавка attention к residual stream',
      id: 'merge:projected',
      source: `blocks.${s.values.block}.attention.projected`,
      pigment: 'purple',
    });
    d.button('merge-residual', 'Прибавить к потоку →', 795, 623, 400, () => enter('residual'));
  }
  function drawNorm(d, s) {
    const n = s.block[s.values.normKind],
      row = n.input[s.token],
      mean = n.mean[s.token],
      variance = n.variance[s.token];
    if (d.compact) {
      d.text(`Среднее μ = ${fmt(mean)}`, d.width / 2, 195, { anchor: 'middle' });
      d.text('(x − μ) / √(σ² + ε)', d.width / 2, 341, { anchor: 'middle' });
      d.text('Затем: γ × результат + β', d.width / 2, 470, { anchor: 'middle' });
      return;
    }
    vector(d, row, 95, 209, 1040, {
      label: 'Исходные координаты',
      pigment: 'purple',
      source: `blocks.${s.values.block}.${s.values.normKind}.input`,
    });
    d.text(`μ = ${fmt(mean, 3)}       σ² = ${fmt(variance, 3)}       ε = 0,00001`, 150, 344, {
      size: 32,
    });
    d.text('(x − μ) / √(σ² + ε) × γ + β', d.width / 2, 411, { anchor: 'middle', size: 36 });
    vector(d, n.output[s.token], 95, 491, 1040, {
      label: 'После LayerNorm',
      pigment: 'ink',
      source: `blocks.${s.values.block}.${s.values.normKind}.output`,
    });
    d.note(
      'Среднее и разброс считаются внутри одного токена. γ и β обучаются отдельно для каждой координаты.',
      115,
      616,
      1020,
      { size: 26 },
    );
  }
  function drawProjection(d, s) {
    const p = s.values,
      headWidth = CONFIG.modelWidth / CONFIG.heads,
      row = p.projection === 'q' ? s.token : s.source;
    const output = s.head[p.projection][row],
      component = p.channel % headWidth;
    const labels = { q: 'Q — сравнивает', k: 'K — с чем сравнить', v: 'V — что передать' };
    if (d.compact) {
      d.text(`«${tokenName(s.trace.tokens[row])}»: 8 → 4 числа`, d.width / 2, 186, {
        anchor: 'middle',
      });
      d.text(
        `${p.projection.toUpperCase()}${component + 1} = ${fmt(output[component], 3)}`,
        d.width / 2,
        285,
        { anchor: 'middle', pigment: 'orange' },
      );
      d.button('projection-kind', `${p.projection.toUpperCase()} →`, 40, d.detailActionY, 300, () =>
        input({ projection: ['q', 'k', 'v'][(['q', 'k', 'v'].indexOf(p.projection) + 1) % 3] }),
      );
      d.button('projection-math', 'Вычислить →', 380, d.detailActionY, 850, () =>
        input({ perspective: 'algebra', kind: 'projection', phase: 0 }),
      );
      return;
    }
    ['q', 'k', 'v'].forEach((id, i) =>
      d.button(
        `projection-${id}`,
        labels[id],
        95 + i * 370,
        140,
        325,
        () => input({ projection: id }),
        { pressed: p.projection === id, pigment: 'orange' },
      ),
    );
    vector(d, s.block.ln1.output[row], 75, 264, 700, {
      label: `LN(x), токен «${tokenName(s.trace.tokens[row])}»`,
      source: `blocks.${s.values.block}.ln1.output`,
      row,
      pigment: 'purple',
    });
    d.line([794, 298], [896, 298], 'orange', true, 3);
    d.box('projection-weight', 920, 234, 240, 170, 'orange', 'marker');
    d.text(`W${p.projection.toUpperCase()} + b`, 1040, 302, {
      anchor: 'middle',
      pigment: 'orange',
      size: 33,
    });
    d.text('обученные веса', 1040, 350, { anchor: 'middle', size: 25 });
    d.line([1040, 412], [1040, 458], 'orange', true, 3);
    vector(d, output, 605, 480, 550, {
      label: `${p.projection.toUpperCase()}, голова ${p.head + 1}`,
      source: `blocks.${p.block}.attention.heads.${p.head}.${p.projection}`,
      row,
      pigment: 'orange',
    });
    d.button('channel', `Координата ${component + 1} →`, 60, 441, 365, () =>
      input({ channel: (component + 1) % headWidth }),
    );
    d.button('projection-math', 'Посчитать из 8 входов →', 60, 520, 395, () =>
      input({ perspective: 'algebra', kind: 'projection', phase: 0 }),
    );
    d.note(
      'Матрицы Q, K и V обучаются независимо; вход у них из того же residual stream.',
      70,
      646,
      1060,
      { size: 26 },
    );
  }
  function drawScores(d, s) {
    const scores = s.head.scaledScores[s.token],
      probs = s.head.probabilities[s.token];
    const normalized = s.head.normalization[s.token],
      exp = normalized.weights,
      total = normalized.totalWeight;
    if (d.compact) {
      const i = s.source;
      d.text(
        `«${tokenName(s.trace.tokens[i])}»: ${i > s.token ? '−∞ · будущее' : fmt(scores[i])}`,
        d.width / 2,
        189,
        {
          anchor: 'middle',
        },
      );
      d.text(`exp(s − max) / Σexp`, d.width / 2, 330, { anchor: 'middle' });
      d.text(`вес = ${percent(probs[i])}`, d.width / 2, 464, {
        anchor: 'middle',
        pigment: 'orange',
      });
      return;
    }
    const headers = ['Откуда', 'q · k / √4', 'После маски', 'exp(s − max)', 'Доля суммы'];
    const xs = [90, 310, 540, 785, 1000];
    headers.forEach((title, i) => d.text(title, xs[i], 168, { size: 26, pigment: 'muted' }));
    scores.forEach((score, i) => {
      const y = 235 + i * Math.min(65, (d.detailActionY - 275) / Math.max(1, scores.length - 1));
      d.text(tokenName(s.trace.tokens[i]), xs[0], y, {
        pigment: i === s.source ? 'orange' : 'ink',
      });
      [
        fmt(score, 3),
        i <= s.token ? fmt(score, 3) : '−∞',
        fmt(exp[i], 3),
        percent(probs[i]),
      ].forEach((value, j) => d.text(value, xs[j + 1], y, { pigment: j === 3 ? 'orange' : 'ink' }));
    });
    d.line([75, 192], [1170, 192], 'muted');
    d.text(`Σ exp = ${fmt(total, 3)}; Σ весов = 1`, 75, d.detailActionY + 42, {
      size: 27,
      pigment: 'orange',
    });
    d.button('score-math', 'Раскрыть q · k →', 775, d.detailActionY, 350, () =>
      input({ perspective: 'algebra', kind: 'score', phase: 0 }),
    );
  }
  function drawActivation(d, s) {
    const x = d.compact ? 115 : 180,
      y = d.compact ? 160 : 175,
      w = d.compact ? 1000 : 850,
      h = d.compact ? d.detailActionY - y - 35 : 335;
    const at = (v, output) => [x + ((v + 4) / 8) * w, y + h - ((output + 1) / 5) * h];
    d.line(at(-4, 0), at(4, 0), 'muted', true);
    d.line(at(0, -1), at(0, 4), 'muted', true);
    const g = d.group('gelu-curve', 'green');
    const points = Array.from({ length: 81 }, (_, i) => at(-4 + i / 10, gelu(-4 + i / 10)));
    paper.pen.polyline(g.content, 'gelu-trace', points, { width: 3 });
    const hidden = s.values.term % CONFIG.hiddenWidth;
    const value = s.block.mlp.preactivation[s.token][hidden];
    const point = at(Math.max(-4, Math.min(4, value)), gelu(Math.max(-4, Math.min(4, value))));
    paper.pen.ellipse(g.content, 'gelu-point', point[0], point[1], 8, 8, { fill: 'marker' });
    d.button(
      'hidden-neuron',
      `Нейрон ${hidden + 1} из 32 →`,
      d.compact ? 270 : 800,
      d.compact ? d.detailActionY : 105,
      d.compact ? 740 : 390,
      () => input({ term: (hidden + 1) % CONFIG.hiddenWidth }),
    );
    if (!d.compact) {
      d.text('GELU(h)', 1000, 230, { pigment: 'green', size: 31 });
      d.text(`h = ${fmt(value, 3)} → ${fmt(gelu(value), 3)}`, 100, 578, {
        pigment: 'green',
        size: 31,
      });
    }
  }
  function drawQueryGeometry(d, s) {
    const q = s.head.q[s.token],
      k = s.head.k[s.source],
      a = s.values.axis % 3,
      b = a + 1;
    const plotTop = 155;
    let plotBottom = 530;
    if (!d.compact) {
      const width = d.width - 260,
        gap = Math.max(16, d.size * 0.65),
        footerTop = d.height - d.hit - 10;
      const detailText = `На рисунке только координаты ${a + 1} и ${b + 1}; остальные также участвуют в сумме.`,
        scoreText = `Оценка в 4 координатах: q · k / 2 = ${fmt(s.head.scaledScores[s.token][s.source], 3)}`;
      const detail = d.note(detailText, 0, 0, width, { size: 25, pigment: 'muted' }),
        score = d.note(scoreText, 0, 0, width, { size: 29, pigment: 'ink' });
      const detailTop = footerTop - gap - detail.bounds.height,
        scoreTop = detailTop - gap - score.bounds.height;
      detail.render(detailText, width, 130 - detail.bounds.x, detailTop - detail.bounds.y);
      score.render(scoreText, width, 130 - score.bounds.x, scoreTop - score.bounds.y);
      plotBottom = Math.min(plotBottom, scoreTop - gap);
    }
    const center = [d.width / 2, d.compact ? 340 : (plotTop + plotBottom) / 2],
      unit =
        (d.compact ? 150 : Math.min(115, (plotBottom - plotTop) / 2 - 36)) /
        Math.max(1, Math.abs(q[a]), Math.abs(q[b]), Math.abs(k[a]), Math.abs(k[b]));
    const end = (v) => [center[0] + v[a] * unit, center[1] - v[b] * unit];
    d.line([140, center[1]], [d.width - 100, center[1]], 'muted', true);
    d.line([center[0], plotBottom], [center[0], plotTop], 'muted', true);
    d.line(center, end(q), 'purple', true, 4);
    d.line(center, end(k), 'orange', true, 4);
    d.annotation('query-end', 'q', end(q)[0] + 15, end(q)[1] - 15, 'purple', 3);
    d.annotation('key-end', 'k', end(k)[0] + 15, end(k)[1] + 40, 'orange', 3);
    if (d.compact)
      d.text(`Координаты ${a + 1}, ${b + 1} из 4`, d.width / 2, 483, {
        anchor: 'middle',
        pigment: 'muted',
      });
  }
  function drawGeometry(d, s) {
    if (s.values.view === 'mlp') return drawActivation(d, s);
    const mix = s.values.view === 'attention' && s.values.kind === 'mix';
    if (['attention', 'scores'].includes(s.values.view) && !mix) return drawQueryGeometry(d, s);
    const p = s.values,
      x = mix
        ? s.head.v[s.source].map((v) => v * s.head.probabilities[s.token][s.source])
        : s.block.input[s.token],
      sum = mix ? s.head.output[s.token] : s.block.afterAttention[s.token],
      delta = mix ? sum.map((v, i) => v - x[i]) : s.block.attention.projected[s.token],
      a = p.axis % (x.length - 1),
      b = a + 1;
    const left = d.compact ? 105 : 180,
      top = d.compact ? 160 : 180,
      w = d.compact ? 1000 : 840,
      h = d.compact ? 360 : 340;
    const points = [
      [0, 0],
      [x[a], x[b]],
      [sum[a], sum[b]],
    ];
    const minX = Math.min(...points.map((v) => v[0])),
      maxX = Math.max(...points.map((v) => v[0]));
    const minY = Math.min(...points.map((v) => v[1])),
      maxY = Math.max(...points.map((v) => v[1]));
    const unit = Math.min(
        (w - 200) / Math.max(1, maxX - minX),
        (h - 50) / Math.max(1, maxY - minY),
      ),
      origin = [
        left + w / 2 - ((minX + maxX) * unit) / 2,
        top + h / 2 + ((minY + maxY) * unit) / 2,
      ];
    const pos = (v) => [origin[0] + v[a] * unit, origin[1] - v[b] * unit];
    d.line([left, origin[1]], [left + w, origin[1]], 'muted', true);
    d.line([origin[0], top + h], [origin[0], top], 'muted', true);
    d.line(origin, pos(x), 'purple', true, 4);
    d.line(pos(x), pos(sum), 'orange', true, 4);
    d.line(origin, pos(sum), 'ink', true, 3);
    d.text(`x${a + 1}`, left + w - 55, origin[1] - 17, { pigment: 'muted' });
    d.text(`x${b + 1}`, origin[0] + 18, top + 15, { pigment: 'muted' });
    if (d.compact) {
      d.annotation('vector-before', mix ? 'aV' : 'x', pos(x)[0] - 80, pos(x)[1] - 30, 'purple', 3);
      d.annotation(
        'vector-result',
        mix ? 'Σ aV' : 'x + Δ',
        pos(sum)[0] + 30,
        pos(sum)[1] - 35,
        'ink',
        4,
      );
      d.annotation(
        'vector-delta',
        mix ? 'остальные' : 'Δ',
        (pos(x)[0] + pos(sum)[0]) / 2 + 35,
        (pos(x)[1] + pos(sum)[1]) / 2,
        'orange',
        2,
      );
    }
    if (!d.compact) {
      d.annotation(
        'vector-before',
        mix ? 'выбранный вклад aV' : 'x',
        pos(x)[0] - 25,
        pos(x)[1] - 42,
        'purple',
        3,
      );
      d.annotation(
        'vector-result',
        mix ? 'сумма aV' : 'x + Δ',
        pos(sum)[0] + 20,
        pos(sum)[1] - 35,
        'ink',
        4,
      );
      d.annotation(
        'vector-delta',
        mix ? 'остальные вклады' : 'Δ attention',
        (pos(x)[0] + pos(sum)[0]) / 2 + 25,
        (pos(x)[1] + pos(sum)[1]) / 2,
        'orange',
        2,
      );
      d.text(`Проекция: координаты ${a + 1} и ${b + 1} из ${x.length}.`, 95, 574, {
        size: 24,
        pigment: 'muted',
      });
      d.button('geometry-axis', `Координаты ${a + 1}, ${b + 1} →`, 850, 104, 325, () =>
        input({ axis: (a + 2) % (x.length - 1) }),
      );
    }
  }
  function drawHardware(d, s) {
    const isMLP = s.values.view === 'mlp';
    const isMix = s.values.view === 'attention' && s.values.kind === 'mix';
    const isResidual = ['residual', 'block'].includes(s.values.view);
    if (isResidual) {
      const i = s.values.channel,
        x = s.block.input[s.token][i],
        delta = s.block.attention.projected[s.token][i],
        sum = s.block.afterAttention[s.token][i];
      if (!d.compact)
        d.text(`Координата ${i + 1}: два регистра → сумматор`, d.width / 2, 174, {
          anchor: 'middle',
        });
      const y = d.compact ? 205 : 250,
        h = 100;
      [
        [75, 'x', x, 'purple'],
        [445, 'Δ', delta, 'orange'],
        [905, 'x + Δ', sum, 'ink'],
      ].forEach(([left, label, value, pigment]) => {
        d.box(`register-${label}`, left, y, 280, h, pigment, 'marker');
        d.text(label, left + 140, y - 25, { anchor: 'middle', pigment });
        d.text(fmt(value, 3), left + 140, y + h / 2 + 14, { anchor: 'middle', pigment });
      });
      d.text('+', 384, y + h / 2 + 14);
      d.line([755, y + h / 2], [875, y + h / 2], 'ink', true, 3);
      d.button('channel', `Координата ${i + 1} →`, 300, d.detailActionY, 680, () =>
        input({ channel: (i + 1) % 8 }),
      );
      if (!d.compact)
        d.note(
          'На схеме — поток данных одной операции сложения. Значения совпадают с residual stream.',
          95,
          470,
          1050,
          { size: 27 },
        );
      return;
    }
    const q = isMLP
      ? s.block.mlp.activation[s.token]
      : isMix
        ? s.head.probabilities[s.token]
        : s.head.q[s.token];
    const k = isMLP
      ? MODEL.weights.blocks[s.values.block].contract.weight.map((row) => row[s.values.channel])
      : isMix
        ? s.head.v.map((row) => row[s.values.channel % 4])
        : s.head.k[s.source];
    const index = s.values.term % q.length;
    const product = q[index] * k[index],
      previous = q.slice(0, index).reduce((sum, v, i) => sum + v * k[i], 0),
      result = previous + product;
    if (d.compact) {
      d.text(`${fmt(q[index])} × ${fmt(k[index])}`, d.width / 2, 180, { anchor: 'middle' });
      d.line([d.width / 2, 208], [d.width / 2, 259], 'orange', true);
      d.text(
        `${fmt(previous)} + ${fmt(product)} = ${fmt(result)}`,
        d.width / 2,
        d.detailActionY - 27,
        {
          anchor: 'middle',
        },
      );
      d.button('hardware-step', `Пара ${index + 1}/${q.length} →`, 370, d.detailActionY, 540, () =>
        input({ term: (index + 1) % q.length }),
      );
      return;
    }
    d.text(`Скалярное произведение · пара ${index + 1} из ${q.length}`, 110, 164, { size: 29 });
    const registers = [
      [60, 235, `${isMLP ? 'GELU(h)' : isMix ? 'вес' : 'q'}${index + 1}`, fmt(q[index]), 'purple'],
      [350, 235, `${isMLP ? 'w' : isMix ? 'V' : 'k'}${index + 1}`, fmt(k[index]), 'orange'],
      [640, 358, 'произведение', fmt(product), 'ink'],
      [945, 358, 'накопитель', fmt(result), 'green'],
    ];
    registers.forEach(([x, y, label, value, pigment], i) => {
      d.box(`register-${i}`, x, y, 215, 108, pigment);
      d.text(label, x + 108, y - 16, { anchor: 'middle', size: 26, pigment });
      d.text(value, x + 108, y + 69, { anchor: 'middle', size: 40, pigment });
    });
    d.line([170, 350], [730, 351], 'muted', true);
    d.line([465, 350], [730, 351], 'muted', true);
    d.text('×', 582, 316, { size: 40 });
    d.line([865, 415], [935, 415], 'green', true);
    d.text(`+ ${fmt(previous)}`, 860, 362, { size: 26, pigment: 'green' });
    const bytes = new DataView(new ArrayBuffer(8));
    bytes.setFloat64(0, q[index]);
    const binary = bytes.getBigUint64(0).toString(2).padStart(64, '0');
    d.text(`binary64: знак ${binary[0]}, порядок ${binary.slice(1, 12)}`, 65, 526, {
      size: 24,
      pigment: 'muted',
    });
    d.text('52 бита дробной части', 65, 565, {
      size: 24,
      pigment: 'muted',
    });
    d.button('hardware-step', 'Следующая пара →', 790, d.detailActionY, 350, () =>
      input({ term: (index + 1) % q.length }),
    );
  }
  function drawModel(d) {
    if (d.compact) {
      d.text('2 блока · 2 головы · 8 каналов', d.width / 2, 187, { anchor: 'middle' });
      d.text('1960 обученных параметров', d.width / 2, 330, { anchor: 'middle' });
      d.text('18 открытых учебных фраз', d.width / 2, 451, { anchor: 'middle' });
      return;
    }
    d.text(`${MODEL.training.corpus.length} учебных фраз`, 65, 170, { size: 34 });
    MODEL.training.corpus
      .slice(0, 3)
      .forEach((phrase, i) =>
        d.text(phrase.replace(/ \.$/, ''), 65, 246 + i * 62, { size: 29, pigment: 'muted' }),
      );
    d.line([560, 306], [749, 306], 'orange', true, 3);
    d.text('обучение', 654, 269, { anchor: 'middle', size: 26, pigment: 'orange' });
    d.text(`${CONFIG.layers} блока · ${CONFIG.modelWidth} каналов`, 760, 170, {
      size: 30,
      pigment: 'purple',
    });
    for (let i = 0; i < CONFIG.layers; i++) {
      const x = 770 + i * 208;
      d.box(`model-block-${i}`, x, 240, 168, 132, 'purple', 'marker');
      d.text(`Блок ${i + 1}`, x + 84, 295, { anchor: 'middle', size: 30, pigment: 'purple' });
      d.text(`${CONFIG.heads} головы`, x + 84, 345, { anchor: 'middle', size: 25 });
      if (i) d.line([x - 31, 306], [x - 9, 306], 'purple', true);
    }
    d.text(`${MODEL.training.parameterCount} обученных параметров`, 960, 425, {
      anchor: 'middle',
      size: 27,
      pigment: 'purple',
    });
    d.text('Здесь токеном служит целое слово.', 65, 489, { size: 28 });
    d.text('Знакомая фраза ещё не проверяет знание мира.', 65, 541, { size: 28, pigment: 'muted' });
    d.button('model-back', 'Исследовать модель →', 805, 591, 380, () => enter('overview'));
  }
})();
