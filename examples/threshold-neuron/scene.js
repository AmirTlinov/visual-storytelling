import { mountScene } from '@visual-storytelling/core';
import { SvgLayout, SketchInk, rough, gsap, widgetState } from '@visual-storytelling/core';
// Subject model: a threshold neuron. Changing this file changes the explanation.
window.galleryReady = (async () => {
  const root = document.getElementById('ve-scene'),
    svg = root.querySelector('svg.canvas');
  const { element: el, place, connect, along, observe } = SvgLayout;
  const select = (key) => root.querySelector(`[data-${key}]`);
  const weights = [3, 4],
    threshold = 9;
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const state = { a: 2, b: 1, mode: 'numbers' };
  const compute = () => {
    const terms = [state.a * weights[0], state.b * weights[1]];
    const sum = terms[0] + terms[1];
    return { terms, sum, output: Number(sum >= threshold) };
  };
  const rc = rough.svg(svg),
    ink = 'var(--ve-ink)';
  const shape = (radius, seed) => {
    const g = el('g'),
      circle = rc.circle(0, 0, radius * 2, {
        seed,
        roughness: 0.25,
        bowing: 0.35,
        disableMultiStroke: true,
        stroke: ink,
        strokeWidth: 1.8,
        fill: 'var(--ve-surface)',
        fillStyle: 'solid',
      });
    g.append(circle);
    select('nodes').append(g);
    return { g, circle };
  };
  const nodes = [shape(28, 31), shape(28, 47), shape(57, 59), shape(25, 71)];
  const label = (value, cls = 'math') => {
    const node = el('text', { class: cls }, value);
    select('labels').append(node);
    return node;
  };
  const inputs = [label('2'), label('1')],
    factors = [label('×3'), label('×4')];
  const weightDetails = [label('', 'small'), label('', 'small')];
  const products = [label('6'), label('4')],
    sumParts = label('6 + 4', 'small');
  const sumLabel = label('10', 'sum'),
    gateLabel = label('≥9'),
    outputLabel = label('1');
  const headings = ['входы', 'веса', 'сумма', 'порог', 'выход'].map((text) =>
    label(text, 'heading'),
  );
  const wire = () => {
    const p = el('path', { class: 'wire' });
    select('wires').append(p);
    return p;
  };
  const wires = Array.from({ length: 6 }, wire),
    arrow = wire();
  const signal = el('circle', { r: 5, class: 'signal' });
  select('nodes').append(signal);
  const tones = ['blue', 'orange'];
  const packets = [...tones, 'purple'].map((tone, i) => {
    const group = el('g', { visibility: 'hidden' });
    group.style.color = `var(--ve-${tone})`;
    group.append(
      el('path', {
        d: SketchInk.inkBox(-24, -18, 48, 34, i + 47),
        fill: `color-mix(in srgb,var(--ve-${tone}) 18%,var(--ve-surface))`,
        stroke: `var(--ve-${tone})`,
        'stroke-width': 1.3,
      }),
    );
    const value = el('text', {
      'text-anchor': 'middle',
      y: 5,
      'font-size': 20,
      fill: `var(--ve-${tone})`,
    });
    group.append(value);
    select('pulses').append(group);
    return { group, value };
  });
  const operation = label('', 'operation');
  tones.forEach((tone, i) => {
    for (const node of [inputs[i], factors[i], products[i], weightDetails[i]])
      node.style.color = `var(--ve-${tone})`;
    for (const node of [wires[i], wires[3 + i]]) node.style.stroke = `var(--ve-${tone})`;
    nodes[i].circle
      .querySelectorAll('path')
      .forEach((p) =>
        p.setAttribute(
          p.getAttribute('fill') === 'none' ? 'stroke' : 'fill',
          `var(--ve-${tone}${p.getAttribute('fill') === 'none' ? '' : '-wash'})`,
        ),
      );
  });
  sumLabel.style.color = 'var(--ve-purple)';
  let routes = [],
    width = 0,
    geometry;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'),
    pulse = { position: 1 };
  let outputRoute,
    operationY = 298;
  function paintPulse() {
    const p = pulse.position,
      { terms, sum, output } = compute();
    const productsReady = p >= 0.68,
      sumReady = p >= 0.68,
      complete = p === 1;
    for (const node of products)
      node.setAttribute('visibility', productsReady ? 'visible' : 'hidden');
    for (const node of [sumLabel, sumParts])
      node.setAttribute('visibility', sumReady ? 'visible' : 'hidden');
    for (const node of [outputLabel, signal])
      node.setAttribute('visibility', complete ? 'visible' : 'hidden');
    const instruction = complete
      ? `${sum} ${output ? '≥' : '<'} ${threshold} → выход ${output}`
      : p < 0.25
        ? 'Умножаем входы на веса'
        : p < 0.68
          ? 'Собираем два вклада'
          : 'Сравниваем сумму с порогом';
    if (operation.textContent !== instruction) {
      operation.textContent = instruction;
      if (width) place(operation, width / 2, operationY);
    }
    root.dataset.phase = complete ? 'complete' : sumReady ? 'threshold' : 'contributions';
    const detail = complete
      ? `${terms.join(' + ')} = ${sum}; ${sum} ${output ? '≥' : '<'} ${threshold} → выход ${output}`
      : operation.textContent;
    if (select('result').textContent !== detail) select('result').textContent = detail;
    svg.querySelector('desc').textContent = complete
      ? `Входы ${state.a} и ${state.b}, веса ${weights.join(' и ')}. ${detail}.`
      : `Входы ${state.a} и ${state.b}. ${operation.textContent}.`;
    packets.forEach(({ group, value }, i) => {
      const start = i === 2 ? 0.72 : 0.25,
        end = i === 2 ? 1 : 0.68;
      const route = i === 2 ? outputRoute : routes[i];
      const visible = route && p >= start && p < end;
      group.setAttribute('visibility', visible ? 'visible' : 'hidden');
      if (!visible) return;
      const t = (p - start) / (end - start);
      const length = Math.hypot(route.end.x - route.start.x, route.end.y - route.start.y);
      const inset = Math.min(26, length * 0.35) / length;
      const position = inset + (1 - 2 * inset) * t;
      group.setAttribute(
        'transform',
        `translate(${route.start.x + (route.end.x - route.start.x) * position} ${route.start.y + (route.end.y - route.start.y) * position})`,
      );
      value.textContent = i === 2 ? sum : terms[i];
    });
  }
  function arrange() {
    if (!width) return 312;
    const vertical = width < 640;
    const positions = vertical
      ? [
          [width * 0.25, 110],
          [width * 0.75, 110],
          [width / 2, 274],
          [width / 2, 424],
        ]
      : [
          [width * 0.25, 83],
          [width * 0.25, 241],
          [width * 0.55, 162],
          [width * 0.77, 162],
        ];
    nodes.forEach(({ g }, i) =>
      g.setAttribute('transform', `translate(${positions[i].join(' ')})`),
    );
    routes = [0, 1].map((i) =>
      connect(nodes[i].circle, nodes[2].circle, {
        fromShape: 'ellipse',
        toShape: 'ellipse',
        gap: 1,
      }),
    );
    routes.forEach((route, i) => {
      wires[i].setAttribute('d', route.d);
      along(products[i], route, { offset: vertical ? (i ? -28 : 28) : i ? 22 : -22 });
    });
    outputRoute = connect(nodes[2].circle, nodes[3].circle, {
      fromShape: 'ellipse',
      toShape: 'ellipse',
      gap: 1,
    });
    wires[2].setAttribute('d', outputRoute.d);
    const [sx, sy] = positions[2],
      [gx, gy] = positions[3];
    factors.forEach((node, i) => {
      place(node, positions[i][0], positions[i][1] - (state.mode === 'formulas' ? 9 : 0));
      place(weightDetails[i], positions[i][0], positions[i][1] + 16);
    });
    place(sumParts, sx, sy - 19);
    place(sumLabel, sx, sy + 18);
    place(gateLabel, gx, gy);
    inputs.forEach((node, i) => {
      const [x, y] = positions[i];
      place(node, vertical ? x : 33, vertical ? 47 : y);
      wires[3 + i].setAttribute('d', vertical ? `M${x} 68V${y - 29}` : `M60 ${y}H${x - 29}`);
    });
    const ex = vertical ? gx : width - 20,
      ey = vertical ? 525 : gy;
    wires[5].setAttribute('d', vertical ? `M${gx} ${gy + 26}V${ey}` : `M${gx + 26} ${gy}H${ex}`);
    arrow.setAttribute(
      'd',
      vertical ? `M${ex - 8} ${ey - 10}l8 10 8-10` : `M${ex - 10} ${ey - 8}l10 8-10 8`,
    );
    signal.setAttribute('cx', vertical ? gx : ex - 28);
    signal.setAttribute('cy', vertical ? ey - 29 : gy);
    place(
      outputLabel,
      vertical ? gx + (state.mode === 'formulas' ? 65 : 36) : ex - 28,
      vertical ? ey - 29 : gy - 28,
    );
    const headingPositions = vertical
      ? [
          [width / 2, 13],
          [width / 2, 110],
          [sx, sy - 39],
          [gx + 66, gy],
          [gx, 551],
        ]
      : [
          [42, 26],
          [positions[0][0], 26],
          [sx, 26],
          [gx, 26],
          [ex - 24, 26],
        ];
    headings.forEach((node, i) => place(node, ...headingPositions[i]));
    operationY = vertical ? 590 : 298;
    place(operation, width / 2, operationY);
    paintPulse();
    return vertical ? 618 : 326;
  }
  function render() {
    const { terms, sum, output } = compute(),
      symbolic = state.mode === 'formulas';
    inputs.forEach((node, i) => {
      node.textContent = symbolic
        ? `x${i ? '₂' : '₁'}=${[state.a, state.b][i]}`
        : [state.a, state.b][i];
    });
    factors.forEach((node, i) => {
      node.textContent = symbolic ? `w${i ? '₂' : '₁'}` : `×${weights[i]}`;
    });
    weightDetails.forEach((node, i) => {
      node.textContent = symbolic ? `= ${weights[i]}` : '';
    });
    sumLabel.style.fontSize = symbolic ? '27px' : '35px';
    products.forEach((node, i) => {
      node.textContent = symbolic ? `w${i ? '₂' : '₁'}x${i ? '₂' : '₁'}` : terms[i];
    });
    sumParts.textContent = symbolic ? 'w₁x₁ + w₂x₂' : terms.join(' + ');
    sumLabel.textContent = symbolic ? `z = ${sum}` : sum;
    gateLabel.textContent = symbolic ? '≥θ' : `≥${threshold}`;
    headings[3].textContent = symbolic ? `θ = ${threshold}` : 'порог';
    outputLabel.textContent = symbolic ? `y = ${output}` : output;
    signal.dataset.active = Boolean(output);
    outputLabel.style.color = output ? 'var(--ve-green)' : 'var(--ve-muted)';
    for (const [key, name, index] of [
      ['a', 'A', '₁'],
      ['b', 'B', '₂'],
    ]) {
      const nameText = `Вход ${symbolic ? `x${index}` : name}`;
      select(key).value = state[key];
      select(`${key}-value`).textContent = state[key];
      select(`${key}-label`).textContent = nameText + ':';
      select(key).setAttribute('aria-label', nameText);
    }
    root
      .querySelectorAll('[data-mode]')
      .forEach((button) => button.setAttribute('aria-pressed', button.dataset.mode === state.mode));
    select('algebra').hidden = !symbolic;
    paintPulse();
    geometry?.update();
  }
  function save() {
    storage.save({
      modelContent: { example: 'neuron', ...state, ...compute() },
      privateContent: { example: 'neuron', ...state },
    });
  }
  function restore(snapshot) {
    const saved = snapshot?.privateContent;
    if (saved?.example !== 'neuron') return false;
    for (const key of ['a', 'b'])
      state[key] = Math.max(0, Math.min(4, Math.round(Number(saved[key]) || 0)));
    state.mode = saved.mode === 'formulas' ? 'formulas' : 'numbers';
    return true;
  }
  const storage = widgetState('threshold-neuron', (snapshot) => {
    if (!restore(snapshot)) return;
    gsap.killTweensOf(pulse);
    pulse.position = 1;
    render();
  });
  for (const key of ['a', 'b'])
    select(key).addEventListener(
      'input',
      () => {
        state[key] = Number(select(key).value);
        gsap.killTweensOf(pulse);
        pulse.position = reduced.matches ? 1 : 0;
        render();
        save();
        if (!reduced.matches)
          gsap.to(pulse, {
            position: 1,
            duration: 1.6,
            ease: 'none',
            overwrite: true,
            onUpdate: paintPulse,
          });
      },
      listen,
    );
  root.querySelectorAll('[data-mode]').forEach((button) =>
    button.addEventListener(
      'click',
      () => {
        state.mode = button.dataset.mode;
        render();
        save();
      },
      listen,
    ),
  );
  reduced.addEventListener(
    'change',
    () => {
      gsap.killTweensOf(pulse);
      pulse.position = 1;
      paintPulse();
    },
    listen,
  );
  restore(storage.read());
  render();
  geometry = await observe(svg, (value) => {
    width = value;
    return arrange();
  });
  mountScene(root, {
    snapshot: () => ({
      ...state,
      ...compute(),
      progress: pulse.position,
      sumVisible: pulse.position >= 0.68,
      outputVisible: pulse.position === 1,
    }),
    dispose() {
      if (abort.signal.aborted) return;
      abort.abort();
      storage.dispose();
      geometry.dispose();
      gsap.killTweensOf(pulse);
      root.replaceChildren();
    },
  });
})().catch((error) => {
  document.querySelector('[data-result]').textContent = error.message;
  throw error;
});
