import { mountScene, StepPlayer, widgetState } from '@visual-storytelling/core';
(() => {
  const root = document.getElementById('ve-scene');
  const svg = root.querySelector('.bs-figure');
  const detail = root.querySelector('[data-detail]');
  const passLabel = root.querySelector('[data-pass]');
  const counts = root.querySelector('[data-counts]');
  const initial = [5, 1, 4, 2, 3];
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function buildSteps(input) {
    const array = input.slice();
    const result = [];
    let comparisons = 0;
    let swaps = 0;
    function add(kind, pair, end, pass, message) {
      result.push({ kind, pair, end, pass, message, array: array.slice(), comparisons, swaps });
    }
    for (let end = array.length - 1; end > 0; end--) {
      const pass = array.length - end;
      for (let i = 0; i < end; i++) {
        const a = array[i];
        const b = array[i + 1];
        comparisons++;
        add(
          'compare',
          [i, i + 1],
          end,
          pass,
          a > b ? `${a} > ${b} — нужно поменять местами` : `${a} ≤ ${b} — оставляем как есть`,
        );
        if (a > b) {
          [array[i], array[i + 1]] = [b, a];
          swaps++;
          add('swap', [i, i + 1], end, pass, `${a} и ${b} меняются местами`);
        }
      }
      if (end > 1) {
        add('pass', [], end - 1, pass, `${array[end]} на своём месте — начинаем снова слева`);
      }
    }
    add('done', [], -1, array.length - 1, 'Готово — числа стоят по возрастанию');
    return result;
  }

  const steps = buildSteps(initial);
  let index = 0;
  let frame = null;
  let width = 0;
  let centers = [];
  let tokens = [];
  let controller;
  let mounted = false,
    restoring = false;
  const abort = new AbortController();

  function restoredIndex(snapshot) {
    const saved = snapshot?.privateContent;
    return saved?.version === 1 && Number.isInteger(saved.step)
      ? Math.max(0, Math.min(steps.length - 1, saved.step))
      : 0;
  }

  function persist() {
    if (!mounted || restoring) return;
    const state = steps[index];
    storage.save({
      modelContent: {
        visualization: 'bubble-sort',
        initial,
        array: state.array,
        step: index,
        phase: state.kind,
        pass: state.pass,
        comparisons: state.comparisons,
        swaps: state.swaps,
      },
      privateContent: { version: 1, step: index },
    });
  }

  function boxPath(x, y, w, h, i) {
    const lean = i % 2 ? 0.7 : -0.7;
    return `M ${x + 3} ${y + lean} Q ${x + w / 2} ${y - 1} ${x + w - 3} ${y}
          Q ${x + w + 0.7} ${y} ${x + w} ${y + 4} L ${x + w + lean} ${y + h - 3}
          Q ${x + w} ${y + h + 0.7} ${x + w - 3} ${y + h}
          L ${x + 3} ${y + h + lean} Q ${x - 0.6} ${y + h} ${x} ${y + h - 3}
          L ${x + lean} ${y + 4} Q ${x} ${y} ${x + 3} ${y + lean} Z`;
  }

  function brace(x1, x2, label, className) {
    return `<path class="bs-line ${className}" d="M ${x1} 159 L ${x1 + 1} 168 Q ${(x1 + x2) / 2} 170 ${x2 - 1} 168 L ${x2} 159"/>
          <text class="text-small" x="${(x1 + x2) / 2}" y="193" text-anchor="middle">${label}</text>`;
  }

  function render() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const state = steps[index];
    width = Math.max(1, svg.getBoundingClientRect().width);
    const pitch = Math.min(105, (width - 16) / initial.length);
    const cellWidth = pitch - 5;
    const start = (width - initial.length * pitch) / 2 + 2.5;
    centers = initial.map((_, i) => start + i * pitch + cellWidth / 2);
    svg.setAttribute('viewBox', `0 0 ${width} 226`);
    let markup = `<title id="bs-title">Сортировка пяти чисел по возрастанию</title>
          <desc id="bs-desc">${state.message}. Массив: ${state.array.join(', ')}.</desc>
          <text x="${width / 2}" y="25" text-anchor="middle">${state.kind === 'done' ? 'Числа по возрастанию' : 'Большее — вправо'}</text>
          <path class="bs-line" d="M ${centers[0]} 43 Q ${width / 2} 42 ${centers[4]} 43 M ${centers[4] - 7} 39 L ${centers[4]} 43 L ${centers[4] - 7} 47"/>`;
    state.array.forEach((_, i) => {
      const active = state.pair.includes(i);
      const sorted = i > state.end;
      const fill = active
        ? i === state.pair[0]
          ? 'bs-active-first'
          : 'bs-active-second'
        : sorted
          ? 'bs-sorted-fill'
          : 'bs-empty-fill';
      markup += `<path class="bs-slot ${fill}" d="${boxPath(start + i * pitch, 85, cellWidth, 60, i)}"/>`;
    });
    if (state.pair.length) {
      markup += brace(
        start + state.pair[0] * pitch + 3,
        start + (state.pair[1] + 1) * pitch - 8,
        state.kind === 'swap'
          ? 'обмен'
          : `${state.array[state.pair[0]]} ${state.array[state.pair[0]] > state.array[state.pair[1]] ? '>' : '≤'} ${state.array[state.pair[1]]}`,
        'bs-active-mark',
      );
    }
    if (state.end < initial.length - 1) {
      markup += brace(
        start + (state.end + 1) * pitch + 3,
        start + initial.length * pitch - 8,
        state.kind === 'done' ? 'всё на месте' : 'на месте',
        'bs-sorted-mark',
      );
    }
    state.array.forEach((value, i) => {
      markup += `<g data-value="${value}" transform="translate(${centers[i]},115)"><text text-anchor="middle" dominant-baseline="middle">${value}</text></g>`;
    });
    const retained = new Map(tokens.map((node) => [node.dataset.value, node]));
    svg.innerHTML = markup;
    tokens = Array.from(svg.querySelectorAll('[data-value]'), (fresh) => {
      const node = retained.get(fresh.dataset.value);
      if (!node) return fresh;
      node.setAttribute('transform', fresh.getAttribute('transform'));
      fresh.replaceWith(node);
      return node;
    });
    detail.textContent = state.message;
    passLabel.textContent =
      state.kind === 'done' ? '4 прохода завершены' : `Проход ${state.pass} из 4`;
    counts.textContent = `Сравнений: ${state.comparisons} · Обменов: ${state.swaps}`;
  }

  function moveTo(target, animate = true) {
    const previous = steps[index];
    index = Math.max(0, Math.min(steps.length - 1, target));
    const current = steps[index];
    render();
    const moved = tokens.filter(
      (token) =>
        previous.array.indexOf(Number(token.dataset.value)) !==
        current.array.indexOf(Number(token.dataset.value)),
    );
    if (animate && !motion.matches && moved.length) {
      const started = performance.now();
      const duration = 620;
      function tick(now) {
        const t = Math.min(1, (now - started) / duration);
        const eased = t * t * (3 - 2 * t);
        moved.forEach((token) => {
          const value = Number(token.dataset.value);
          const from = centers[previous.array.indexOf(value)];
          const to = centers[current.array.indexOf(value)];
          const x = from + (to - from) * eased;
          const y = 115 + (to > from ? -1 : 1) * 27 * Math.sin(Math.PI * eased);
          token.setAttribute('transform', `translate(${x},${y})`);
        });
        frame = t < 1 ? requestAnimationFrame(tick) : null;
      }
      tick(started);
    }
    persist();
  }

  const storage = widgetState('bubble-sort', (snapshot) => {
    const restored = restoredIndex(snapshot);
    if (restored === index) return;
    restoring = true;
    try {
      controller.go(restored);
    } finally {
      restoring = false;
    }
  });
  motion.addEventListener('change', () => render(), { signal: abort.signal });
  const observer = new ResizeObserver(() => {
    if (Math.abs(svg.getBoundingClientRect().width - width) > 0.5) render();
  });
  observer.observe(svg);
  index = restoredIndex(storage.read());
  controller = StepPlayer.mount(root, {
    count: steps.length,
    initial: index,
    render: (target, _previous, animate) => moveTo(target, animate),
  });
  mounted = true;
  mountScene(
    root,
    {
      play: controller.play,
      pause: controller.pause,
      get playing() {
        return controller.playing;
      },
      snapshot: () => ({ step: index, ...steps[index] }),
      dispose() {
        mounted = false;
        controller.dispose();
        observer.disconnect();
        abort.abort();
        storage.dispose();
        if (frame !== null) cancelAnimationFrame(frame);
        root.replaceChildren();
      },
    },
    {
      parameters: [
        { key: 'step', label: 'Шаг объяснения', value: 0, min: 0, max: steps.length - 1, step: 1 },
      ],
      values: () => ({ step: index }),
      setValues: ({ step }) => controller.go(Number(step)),
    },
  );
})();
