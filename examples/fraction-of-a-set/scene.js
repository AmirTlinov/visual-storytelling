import { SvgLayout, rough, gsap } from '@visual-storytelling/core';
(async () => {
  const root = document.getElementById('ve-scene'), svg = root.querySelector('.canvas');
  const {element: el, place, observe} = SvgLayout, rc = rough.svg(svg);
  const find = key => root.querySelector(`[data-${key}]`), total = 12;
  const state = {parts: 3, taken: 2, mode: 'numbers'};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let layout, width = 0, first = true, animateNext = false;
  const chips = Array.from({length: total}, (_, i) => {
    const node = el('g', {'data-chip': i}), pose = {x: 0, y: 0};
    node.append(rc.circle(0, 0, 23, {seed: i + 5, roughness: .6, stroke: 'var(--ve-ink)', strokeWidth: 1.5, disableMultiStroke: true, fill: 'var(--ve-wash)', fillStyle: 'solid'}));
    find('chips').append(node);
    return {node, pose};
  });
  function text(value, x, y, cls = '') {
    const node = el('text', {class: cls}, value); find('labels').append(node); place(node, x, y); return node;
  }
  function draw(animate = false) {
    if (!width) return 350;
    const perPart = total / state.parts, chosen = perPart * state.taken;
    const columns = [6, 4, 3, 2, 1].find(n => n <= Math.max(2, Math.floor(width / 160)) && state.parts % n === 0);
    const rows = Math.ceil(state.parts / columns), slot = Math.min(190, (width - 16) / columns);
    const left = (width - slot * columns) / 2, top = 68, groupHeight = 137;
    find('guides').replaceChildren(); find('labels').replaceChildren();
    text('всего 12 фишек', width / 2, 23, 'note');
    find('guides').append(el('path', {class: 'ink-line', d: `M${left + 6} 47v-8H${width - left - 6}v8`}));
    for (let part = 0; part < state.parts; part++) {
      const x = left + (part % columns) * slot + 5, y = top + Math.floor(part / columns) * groupHeight;
      const selected = part < state.taken;
      find('guides').append(rc.rectangle(x, y, slot - 10, 116, {seed: part + 100, roughness: .4, stroke: selected ? 'var(--ve-orange)' : 'var(--ve-pencil)', strokeWidth: 1.3, disableMultiStroke: true, fill: selected ? 'var(--ve-orange-wash)' : 'none', fillStyle: 'solid'}));
      text(state.mode === 'formulas' ? `12 / ${state.parts} = ${perPart}` : `${perPart} ${perPart === 6 ? "фишек" : "фишки"}`, x + (slot - 10) / 2, y + 96, 'note');
      const across = perPart === 6 ? 3 : 2, chipRows = Math.ceil(perPart / across);
      for (let j = 0; j < perPart; j++) {
        const item = chips[part * perPart + j];
        const target = {x: x + (slot - 10) / 2 + ((j % across) - (across - 1) / 2) * 33,
          y: y + 39 + (Math.floor(j / across) - (chipRows - 1) / 2) * 32};
        gsap.killTweensOf(item.pose);
        item.node.dataset.selected = selected;
        item.node.querySelectorAll('path[fill]:not([fill="none"])').forEach(p => p.setAttribute('fill', selected ? 'var(--ve-orange-soft)' : 'var(--ve-surface)'));
        const paint = () => item.node.setAttribute('transform', `translate(${item.pose.x} ${item.pose.y})`);
        if (animate && !first && !reduced.matches) gsap.to(item.pose, {...target, duration: .5, ease: 'power2.inOut', onUpdate: paint});
        else {Object.assign(item.pose, target); paint();}
      }
    }
    const baseline = top + rows * groupHeight + 7;
    text(`${state.taken}/${state.parts} × 12 = ${chosen}`, width / 2, baseline, 'fraction-result orange');
    if (state.mode === 'formulas') text('m/n × N — выбранная доля', width / 2, baseline + 37, 'note');
    find('taken').max = state.parts; find('taken').value = state.taken;
    find('taken').setAttribute('aria-valuetext', `${state.taken} из ${state.parts}`);
    find('count').textContent = `${state.taken} из ${state.parts}`;
    root.querySelectorAll('[data-parts]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.parts) === state.parts));
    root.querySelectorAll('[data-mode]:not([data-parts])').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === state.mode));
    const description = `Всего 12 фишек. Равных частей: ${state.parts}, в каждой ${perPart}. Выбрано частей: ${state.taken}; фишек: ${chosen}.`;
    svg.querySelector('desc').textContent = description; find('result').textContent = description;
    first = false;
    return baseline + (state.mode === 'formulas' ? 67 : 32);
  }
  function save() {window.openai?.setWidgetState?.({modelContent: {example: 'fraction', total, ...state, result: total / state.parts * state.taken}, privateContent: {example: 'fraction', ...state}})?.catch(() => {});}
  function restore(snapshot) {
    const s = snapshot?.privateContent;
    if (s?.example !== 'fraction' || ![2, 3, 4, 6].includes(s.parts)) return;
    state.parts = s.parts; state.taken = Math.max(0, Math.min(s.parts, Math.round(Number(s.taken) || 0)));
    state.mode = s.mode === 'formulas' ? 'formulas' : 'numbers';
  }
  root.querySelectorAll('[data-parts]').forEach(b => b.addEventListener('click', () => {state.parts = Number(b.dataset.parts); state.taken = Math.min(state.parts, state.taken); animateNext = true; layout?.update(); save();}));
  find('taken').addEventListener('input', () => {state.taken = Number(find('taken').value); draw(); save();});
  root.querySelectorAll('[data-mode]:not([data-parts])').forEach(b => b.addEventListener('click', () => {state.mode = b.dataset.mode; layout?.update(); save();}));
  reduced.addEventListener('change', () => draw());
  window.addEventListener('openai:set_globals', e => {restore(e.detail?.globals?.widgetState); layout?.update();});
  restore(window.openai?.widgetState);
  layout = await observe(svg, w => {width = w; const height = draw(animateNext); animateNext = false; return height;});
})().catch(console.error);
