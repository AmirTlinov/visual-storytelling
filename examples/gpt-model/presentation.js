import { surface, describeObject } from '@visual-storytelling/core';
import { MODEL, PRESETS } from './model.js';
import { mountComputation } from './computation.js';
import { drawing, drawingMetrics } from './drawing.js';
import { gptDrawings } from './presentation/drawings.js';
import { names } from './selection.js';
import {
  fmt,
  percent,
  tokenName,
  options,
  parentView,
  perspectives,
  kindFor,
} from './presentation/format.js';
export function createGPTPresentation(shell) {
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
    current,
    representation,
    releaseRepresentation;
  const enter = (view, patch = {}) =>
    shell.input({ view, perspective: 'diagram', detailPage: -1, ...patch });
  const input = (patch) => shell.input(patch);
  const selectPreset = () => {
    const index = PRESETS.findIndex((p) => p.id === current.values.preset);
    input({ preset: PRESETS[(index + 1) % PRESETS.length].id });
  };
  const {
    tokens,
    vector,
    drawDetails,
    drawOverview,
    drawEmbedding,
    drawBlock,
    drawAttention,
    drawResidual,
    drawMLP,
    predictionChoices,
    drawOutput,
    drawLogits,
    drawMerge,
    drawNorm,
    drawProjection,
    drawScores,
    drawActivation,
    drawQueryGeometry,
    drawGeometry,
    drawHardware,
    drawModel,
  } = gptDrawings({
    paper,
    input,
    enter,
    selectPreset,
    get current() {
      return current;
    },
  });

  const needsMath = (p) =>
    p.detailPage < 0 &&
    p.perspective === 'algebra' &&
    !['overview', 'embedding', 'output', 'model', 'norm', 'merge'].includes(p.view);
  let attached = false;
  function mathLayout() {
    const { width: W, height: H, compact } = shell.layout,
      { hit, detailActionY } = drawingMetrics(shell.layout),
      margin = compact ? 24 : 40,
      y = compact ? 110 : 153,
      end = compact ? H - hit - 26 : detailActionY - 20;
    Object.assign(mathHost.style, {
      left: `${margin}px`,
      top: `${y}px`,
      width: `${W - 2 * margin}px`,
      height: `${Math.max(1, end - y)}px`,
    });
  }
  function renderMath(state, frame) {
    const p = state.values;
    if (!computation) {
      computation = mountComputation(mathHost);
      computation.setActive(false);
    }
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
      reduced: frame?.reduced ?? false,
      compact: shell.layout.compact,
      candidate: state.candidate,
    });
  }
  let preparation = 0;
  function prepare(state, frame, signal) {
    if (
      !needsMath(state.values) ||
      (!mathHost.hidden && !mathHost.hasAttribute('data-presentation-pending'))
    )
      return;
    const revision = ++preparation;
    return (async () => {
      mathLayout();
      mathHost.dataset.presentationPending = '';
      mathHost.style.clipPath = 'inset(100%)';
      mathHost.inert = true;
      mathHost.hidden = false;
      try {
        renderMath(state, frame);
        await computation.ready(signal);
        signal.throwIfAborted();
      } finally {
        // The accepted SVG and its semantic objects remain untouched until render.
        if (revision === preparation) {
          mathHost.hidden = true;
          mathHost.style.removeProperty('clip-path');
          mathHost.inert = false;
          delete mathHost.dataset.presentationPending;
        }
      }
    })();
  }
  function render(state, frame, mode, identity) {
    preparation++;
    mathHost.style.removeProperty('clip-path');
    mathHost.inert = false;
    delete mathHost.dataset.presentationPending;
    current = { ...state, modelId: identity.modelId };
    const nextRepresentation = `${identity.view.id}/${state.values.view}`;
    if (representation !== nextRepresentation) {
      releaseRepresentation?.();
      representation = nextRepresentation;
      paper.element.dataset.object = identity.view.id;
      releaseRepresentation = describeObject(paper.element, {
        label: names[state.values.view],
        interactive: false,
        provenance: () => ({
          model: current.modelId,
          token: current.token,
          block: current.values.block,
          head: current.values.head,
        }),
      });
    }
    const layout = shell.layout;
    const { width: W, height: H, compact, scale } = layout;
    if (!W || !H) return;
    paper.resize(W, H, false);
    const p = state.values;
    const isMath = needsMath(p);
    mathHost.hidden = !isMath;
    const key = JSON.stringify([
      { ...p, phase: undefined },
      state.token,
      identity.modelId,
      representation,
      W,
      H,
      scale,
      isMath,
    ]);
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
      if (compact && p.detailPage >= 0) drawDetails(d, state);
      else if (isMath) {
        mathLayout();
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
    artwork.render(state.steps, mode);
    if (isMath) {
      renderMath(state, frame);
      if (!attached) {
        shell.attachView(computation.view);
        attached = true;
      }
      computation.setActive(true);
    } else computation?.setActive(false);
  }
  return {
    render,
    prepare,
    ready: (signal) => (!mathHost.hidden ? computation?.ready(signal) : undefined),
    dispose() {
      releaseRepresentation?.();
      artwork?.dispose();
      paper.dispose();
      computation?.dispose();
    },
    snapshot() {
      return current;
    },
  };
}
