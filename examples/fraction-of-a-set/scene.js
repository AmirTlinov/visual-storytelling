import { mountScene } from '@visual-storytelling/core';
import { SvgLayout, rough, gsap, widgetState } from '@visual-storytelling/core';
window.galleryReady = (async () => {
  const root = document.getElementById('ve-scene'),
    svg = root.querySelector('.canvas');
  const { element: el, place, observe } = SvgLayout,
    rc = rough.svg(svg);
  const find = (key) => root.querySelector(`[data-${key}]`),
    total = 12;
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const state = { parts: 3, taken: 2, mode: 'numbers' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let layout,
    width = 0,
    first = true,
    animateNext = false;
  const movement = { progress: 1 };
  let settled = true;
  const chips = Array.from({ length: total }, (_, i) => {
    const node = el('g', { 'data-chip': i }),
      pose = { x: 0, y: 0 };
    node.append(
      rc.circle(0, 0, 23, {
        seed: i + 5,
        roughness: 0.6,
        stroke: 'var(--ve-ink)',
        strokeWidth: 1.5,
        disableMultiStroke: true,
        fill: 'var(--ve-wash)',
        fillStyle: 'solid',
      }),
    );
    find('chips').append(node);
    return { node, pose };
  });
  function text(value, x, y, cls = '') {
    const node = el('text', { class: cls, 'data-arrival': '' }, value);
    find('labels').append(node);
    place(node, x, y);
    return node;
  }
  function draw(animate = !settled) {
    if (!width) return 350;
    gsap.killTweensOf(movement);
    const moving = animate && !first && !reduced.matches;
    movement.progress = moving ? 0 : 1;
    const starts = chips.map(({ pose }) => ({ ...pose }));
    const targets = [];
    const perPart = total / state.parts,
      chosen = perPart * state.taken;
    const columns = [6, 4, 3, 2, 1].find(
      (n) => n <= Math.max(2, Math.floor(width / 160)) && state.parts % n === 0,
    );
    const rows = Math.ceil(state.parts / columns),
      slot = Math.min(190, (width - 16) / columns);
    const left = (width - slot * columns) / 2,
      top = 68,
      groupHeight = 137;
    find('guides').replaceChildren();
    find('labels').replaceChildren();
    const instruction = text('', width / 2, 23, 'note');
    instruction.removeAttribute('data-arrival');
    find('guides').append(
      el('path', { class: 'ink-line', d: `M${left + 6} 47v-8H${width - left - 6}v8` }),
    );
    for (let part = 0; part < state.parts; part++) {
      const x = left + (part % columns) * slot + 5,
        y = top + Math.floor(part / columns) * groupHeight;
      const selected = part < state.taken;
      const guide = rc.rectangle(x, y, slot - 10, 116, {
        seed: part + 100,
        roughness: 0.4,
        stroke: 'var(--ve-pencil)',
        strokeWidth: 1.3,
        disableMultiStroke: true,
        fill: 'none',
        fillStyle: 'solid',
      });
      guide.dataset.part = part;
      find('guides').append(guide);
      text(
        state.mode === 'formulas'
          ? `12 / ${state.parts} = ${perPart}`
          : `${perPart} ${perPart === 6 ? 'фишек' : 'фишки'}`,
        x + (slot - 10) / 2,
        y + 96,
        'note',
      );
      const across = perPart === 6 ? 3 : 2,
        chipRows = Math.ceil(perPart / across);
      for (let j = 0; j < perPart; j++) {
        const item = chips[part * perPart + j];
        const target = {
          x: x + (slot - 10) / 2 + ((j % across) - (across - 1) / 2) * 33,
          y: y + 39 + (Math.floor(j / across) - (chipRows - 1) / 2) * 32,
        };
        targets.push({ item, target, selected });
      }
    }
    const baseline = top + rows * groupHeight + 7;
    text(
      `${state.taken}/${state.parts} × 12 = ${chosen}`,
      width / 2,
      baseline,
      'fraction-result orange',
    );
    if (state.mode === 'formulas')
      text('m/n × N — выбранная доля', width / 2, baseline + 37, 'note');
    find('taken').max = state.parts;
    find('taken').value = state.taken;
    find('taken').setAttribute('aria-valuetext', `${state.taken} из ${state.parts}`);
    find('count').textContent = `${state.taken} из ${state.parts}`;
    root
      .querySelectorAll('[data-parts]')
      .forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.parts) === state.parts));
    root
      .querySelectorAll('[data-mode]:not([data-parts])')
      .forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === state.mode));
    const description = `Всего 12 фишек. Равных частей: ${state.parts}, в каждой ${perPart}. Выбрано частей: ${state.taken}; фишек: ${chosen}.`;
    let published;
    function paint() {
      settled = movement.progress === 1;
      targets.forEach(({ item, target }, i) => {
        item.pose.x = starts[i].x + (target.x - starts[i].x) * movement.progress;
        item.pose.y = starts[i].y + (target.y - starts[i].y) * movement.progress;
        item.node.setAttribute('transform', `translate(${item.pose.x} ${item.pose.y})`);
      });
      if (published === settled) return;
      published = settled;
      root.dataset.phase = settled ? 'complete' : 'arranging';
      instruction.textContent = settled ? 'Всего 12 фишек' : 'Раскладываем 12 фишек поровну';
      place(instruction, width / 2, 23);
      find('labels')
        .querySelectorAll('[data-arrival]')
        .forEach((node) => {
          node.setAttribute('visibility', settled ? 'visible' : 'hidden');
        });
      targets.forEach(({ item, selected }) => {
        item.node.dataset.selected = settled && selected;
        item.node
          .querySelectorAll('path[fill]:not([fill="none"])')
          .forEach((path) =>
            path.setAttribute(
              'fill',
              settled && selected ? 'var(--ve-orange-soft)' : 'var(--ve-surface)',
            ),
          );
      });
      find('guides')
        .querySelectorAll('[data-part]')
        .forEach((guide) => {
          const chosen = settled && Number(guide.dataset.part) < state.taken;
          guide.querySelectorAll('path').forEach((path) => {
            path.setAttribute('fill', chosen ? 'var(--ve-orange-wash)' : 'none');
            path.setAttribute('stroke', chosen ? 'var(--ve-orange)' : 'var(--ve-pencil)');
          });
        });
      svg.querySelector('desc').textContent = settled
        ? description
        : 'Те же двенадцать фишек перемещаются в новые равные группы.';
      find('result').textContent = settled ? description : 'Перегруппировка двенадцати фишек.';
    }
    paint();
    if (moving)
      gsap.to(movement, { progress: 1, duration: 0.75, ease: 'power2.inOut', onUpdate: paint });
    first = false;
    return baseline + (state.mode === 'formulas' ? 67 : 32);
  }
  function save() {
    storage.save({
      modelContent: {
        example: 'fraction',
        total,
        ...state,
        result: (total / state.parts) * state.taken,
      },
      privateContent: { example: 'fraction', ...state },
    });
  }
  function restore(snapshot) {
    const s = snapshot?.privateContent;
    if (s?.example !== 'fraction' || ![2, 3, 4, 6].includes(s.parts)) return false;
    state.parts = s.parts;
    state.taken = Math.max(0, Math.min(s.parts, Math.round(Number(s.taken) || 0)));
    state.mode = s.mode === 'formulas' ? 'formulas' : 'numbers';
    return true;
  }
  const storage = widgetState('fraction-of-a-set', (snapshot) => {
    if (!restore(snapshot)) return;
    gsap.killTweensOf(movement);
    settled = true;
    layout?.update();
  });
  root.querySelectorAll('[data-parts]').forEach((b) =>
    b.addEventListener(
      'click',
      () => {
        const parts = Number(b.dataset.parts);
        if (parts === state.parts) return;
        state.parts = parts;
        state.taken = Math.min(state.parts, state.taken);
        animateNext = true;
        layout?.update();
        save();
      },
      listen,
    ),
  );
  find('taken').addEventListener(
    'input',
    () => {
      state.taken = Number(find('taken').value);
      draw();
      save();
    },
    listen,
  );
  root.querySelectorAll('[data-mode]:not([data-parts])').forEach((b) =>
    b.addEventListener(
      'click',
      () => {
        state.mode = b.dataset.mode;
        layout?.update();
        save();
      },
      listen,
    ),
  );
  reduced.addEventListener('change', () => draw(), listen);
  restore(storage.read());
  layout = await observe(svg, (w) => {
    width = w;
    const height = draw(animateNext || !settled);
    animateNext = false;
    return height;
  });
  mountScene(root, {
    snapshot: () => ({
      ...state,
      total,
      settled,
      result: settled ? (total / state.parts) * state.taken : null,
      positions: chips.map(({ pose }) => ({ ...pose })),
    }),
    dispose() {
      if (abort.signal.aborted) return;
      abort.abort();
      storage.dispose();
      layout.dispose();
      gsap.killTweensOf(movement);
      root.replaceChildren();
    },
  });
})();
