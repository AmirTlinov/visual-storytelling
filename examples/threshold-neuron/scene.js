import { SvgLayout, rough, gsap } from '@visual-storytelling/core';
// Subject model: a threshold neuron. Changing this file changes the explanation.
(async () => {
  const root = document.getElementById('ve-scene'), svg = root.querySelector('svg.canvas');
  const {element: el, place, connect, along, observe} = SvgLayout;
  const select = key => root.querySelector(`[data-${key}]`);
  const weights = [3, 4], threshold = 9;
  const state = {a: 2, b: 1, mode: 'numbers'};
  const compute = () => {const terms = [state.a * weights[0], state.b * weights[1]]; const sum = terms[0] + terms[1]; return {terms, sum, output: Number(sum >= threshold)};};
  const rc = rough.svg(svg), ink = 'var(--ve-ink)';
  const shape = (radius, seed) => {
    const g = el('g'), circle = rc.circle(0, 0, radius * 2, {seed, roughness: .25, bowing: .35, disableMultiStroke: true, stroke: ink, strokeWidth: 1.8, fill: 'var(--ve-surface)', fillStyle: 'solid'});
    g.append(circle); select('nodes').append(g); return {g, circle};
  };
  const nodes = [shape(28, 31), shape(28, 47), shape(57, 59), shape(25, 71)];
  const label = (value, cls = 'math') => {const node = el('text', {class: cls}, value); select('labels').append(node); return node;};
  const inputs = [label('2'), label('1')], factors = [label('×3'), label('×4')];
  const weightDetails = [label('', 'small'), label('', 'small')];
  const products = [label('6'), label('4')], sumParts = label('6 + 4', 'small');
  const sumLabel = label('10', 'sum'), gateLabel = label('≥9'), outputLabel = label('1');
  const headings = ['входы', 'веса', 'сумма', 'порог', 'выход'].map(text => label(text, 'heading'));
  const wire = () => {const p = el('path', {class: 'wire'}); select('wires').append(p); return p;};
  const wires = Array.from({length: 6}, wire), arrow = wire();
  const signal = el('circle', {r: 5, class: 'signal'}); select('nodes').append(signal);
  const tones = ['blue', 'orange'];
  const pulses = tones.map(tone => {const p = el('circle', {r: 4, fill: `var(--ve-${tone})`, visibility: 'hidden'}); select('pulses').append(p); return p;});
  tones.forEach((tone, i) => {
    for (const node of [inputs[i], factors[i], products[i], weightDetails[i]]) node.style.color = `var(--ve-${tone})`;
    for (const node of [wires[i], wires[3 + i]]) node.style.stroke = `var(--ve-${tone})`;
    nodes[i].circle.querySelectorAll('path').forEach(p => p.setAttribute(p.getAttribute('fill') === 'none' ? 'stroke' : 'fill', `var(--ve-${tone}${p.getAttribute('fill') === 'none' ? '' : '-wash'})`));
  });
  sumLabel.style.color = 'var(--ve-purple)';
  let routes = [], width = 0, geometry;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), pulse = {position: 1};
  function paintPulse() {
    pulses.forEach((node, i) => {
      const route = routes[i];
      if (!route || pulse.position >= 1 || reduced.matches) {node.setAttribute('visibility', 'hidden'); return;}
      node.setAttribute('visibility', 'visible');
      node.setAttribute('cx', route.start.x + (route.end.x - route.start.x) * pulse.position);
      node.setAttribute('cy', route.start.y + (route.end.y - route.start.y) * pulse.position);
    });
  }
  function arrange() {
    if (!width) return 312;
    const vertical = width < 640;
    const positions = vertical ? [[width * .25, 110], [width * .75, 110], [width / 2, 244], [width / 2, 366]]
      : [[width * .25, 83], [width * .25, 241], [width * .55, 162], [width * .77, 162]];
    nodes.forEach(({g}, i) => g.setAttribute('transform', `translate(${positions[i].join(' ')})`));
    routes = [0, 1].map(i => connect(nodes[i].circle, nodes[2].circle, {fromShape: 'ellipse', toShape: 'ellipse', gap: 1}));
    routes.forEach((route, i) => {wires[i].setAttribute('d', route.d); along(products[i], route, {offset: vertical ? (i ? -28 : 28) : (i ? 22 : -22)});});
    wires[2].setAttribute('d', connect(nodes[2].circle, nodes[3].circle, {fromShape: 'ellipse', toShape: 'ellipse', gap: 1}).d);
    const [sx, sy] = positions[2], [gx, gy] = positions[3];
    factors.forEach((node, i) => {place(node, positions[i][0], positions[i][1] - (state.mode === 'formulas' ? 9 : 0)); place(weightDetails[i], positions[i][0], positions[i][1] + 16);});
    place(sumParts, sx, sy - 19); place(sumLabel, sx, sy + 18); place(gateLabel, gx, gy);
    inputs.forEach((node, i) => {
      const [x, y] = positions[i];
      place(node, vertical ? x : 33, vertical ? 47 : y);
      wires[3 + i].setAttribute('d', vertical ? `M${x} 68V${y - 29}` : `M60 ${y}H${x - 29}`);
    });
    const ex = vertical ? gx : width - 20, ey = vertical ? 455 : gy;
    wires[5].setAttribute('d', vertical ? `M${gx} ${gy + 26}V${ey}` : `M${gx + 26} ${gy}H${ex}`);
    arrow.setAttribute('d', vertical ? `M${ex - 8} ${ey - 10}l8 10 8-10` : `M${ex - 10} ${ey - 8}l10 8-10 8`);
    signal.setAttribute('cx', vertical ? gx : ex - 28); signal.setAttribute('cy', vertical ? ey - 29 : gy);
    place(outputLabel, vertical ? gx + (state.mode === 'formulas' ? 65 : 36) : ex - 28, vertical ? ey - 29 : gy - 28);
    const headingPositions = vertical ? [[width / 2, 13], [width / 2, 110], [sx, sy - 79], [gx + 66, gy], [gx, 481]]
      : [[42, 26], [positions[0][0], 26], [sx, 26], [gx, 26], [ex - 24, 26]];
    headings.forEach((node, i) => place(node, ...headingPositions[i]));
    paintPulse();
    return vertical ? 505 : 312;
  }
  function render() {
    const {terms, sum, output} = compute(), symbolic = state.mode === 'formulas';
    inputs.forEach((node, i) => {node.textContent = symbolic ? `x${i ? '₂' : '₁'}=${[state.a, state.b][i]}` : [state.a, state.b][i];});
    factors.forEach((node, i) => {node.textContent = symbolic ? `w${i ? '₂' : '₁'}` : `×${weights[i]}`;});
    weightDetails.forEach((node, i) => {node.textContent = symbolic ? `= ${weights[i]}` : '';});
    sumLabel.style.fontSize = symbolic ? '27px' : '35px';
    products.forEach((node, i) => {node.textContent = symbolic ? `w${i ? '₂' : '₁'}x${i ? '₂' : '₁'}` : terms[i];});
    sumParts.textContent = symbolic ? 'w₁x₁ + w₂x₂' : terms.join(' + ');
    sumLabel.textContent = symbolic ? `z = ${sum}` : sum; gateLabel.textContent = symbolic ? '≥θ' : `≥${threshold}`;
    headings[3].textContent = symbolic ? `θ = ${threshold}` : 'порог';
    outputLabel.textContent = symbolic ? `y = ${output}` : output; signal.dataset.active = Boolean(output);
    outputLabel.style.color = output ? 'var(--ve-green)' : 'var(--ve-muted)';
    for (const [key, name, index] of [['a', 'A', '₁'], ['b', 'B', '₂']]) {
      const nameText = `Вход ${symbolic ? `x${index}` : name}`;
      select(key).value = state[key]; select(`${key}-value`).textContent = state[key];
      select(`${key}-label`).textContent = nameText + ':'; select(key).setAttribute('aria-label', nameText);
    }
    root.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', button.dataset.mode === state.mode));
    select('algebra').hidden = !symbolic;
    select('result').textContent = `${symbolic ? 'z = ' : ''}${terms[0]} + ${terms[1]} = ${sum}; ${sum} ${output ? '≥' : '<'} ${threshold} → ${symbolic ? 'y' : 'выход'} ${output}`;
    root.querySelector('desc').textContent = `Входы ${state.a} и ${state.b}, веса ${weights.join(' и ')}. Вклады ${terms.join(' и ')}, сумма ${sum}. Порог ${threshold}. Выход ${output}.`;
    geometry?.update();
  }
  function save() {window.openai?.setWidgetState?.({modelContent: {example: 'neuron', ...state, ...compute()}, privateContent: {example: 'neuron', ...state}})?.catch(() => {});}
  function restore(snapshot) {
    const saved = snapshot?.privateContent;
    if (saved?.example !== 'neuron') return;
    for (const key of ['a', 'b']) state[key] = Math.max(0, Math.min(4, Math.round(Number(saved[key]) || 0)));
    state.mode = saved.mode === 'formulas' ? 'formulas' : 'numbers';
  }
  for (const key of ['a', 'b']) select(key).addEventListener('input', () => {
    state[key] = Number(select(key).value); render(); save();
    gsap.killTweensOf(pulse); pulse.position = reduced.matches ? 1 : 0; paintPulse();
    if (!reduced.matches) gsap.to(pulse, {position: 1, duration: .45, ease: 'none', overwrite: true, onUpdate: paintPulse});
  });
  root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {state.mode = button.dataset.mode; render(); save();}));
  window.addEventListener('openai:set_globals', event => {restore(event.detail?.globals?.widgetState); render();});
  reduced.addEventListener('change', () => {gsap.killTweensOf(pulse); pulse.position = 1; paintPulse();});
  restore(window.openai?.widgetState); render();
  geometry = await observe(svg, value => {width = value; return arrange();});
})().catch(error => {document.querySelector('[data-result]').textContent = error.message; console.error(error);});
