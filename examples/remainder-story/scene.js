import { mountScene, SceneShell } from '@visual-storytelling/core';
import {
  SketchMotion,
  captionTrack,
  SvgLayout,
  story,
  player as storyPlayer,
  rough,
  gsap,
  progress,
} from '@visual-storytelling/core';
import narrationTiming from './timeline.json' with { type: 'json' };
window.galleryReady = (async () => {
  const root = document.getElementById('ve-scene'),
    svg = root.querySelector('svg.canvas');
  const composition = document.createElement('div'),
    paper = root.querySelector('.paper');
  paper.classList.add('ve-stage');
  composition.append(
    paper,
    root.querySelector('[data-player]'),
    root.querySelector('[data-caption]'),
  );
  const frame = SceneShell.frame(composition, { width: 1280, height: 720, scope: 'scene' });
  root.append(frame.element);
  frame.resize();
  const layer = root.querySelector('[data-drawing]'),
    audio = root.querySelector('audio');
  const timing = narrationTiming;
  const { element: el, place, row, observe } = SvgLayout;
  const { trace, write, resetText } = SketchMotion;
  const count = 23,
    divisor = 3,
    groupsCount = Math.floor(count / divisor),
    remainder = count % divisor;
  const C = timing.cues,
    rc = rough.svg(svg);
  const colors = { blue: 'var(--ve-blue)', orange: 'var(--ve-orange)', purple: 'var(--ve-purple)' };
  const addText = (value, cls = '', color) => {
    const owner = el('g', { 'data-label': '' }),
      text = el('text', { class: cls }, value);
    if (color) owner.style.color = color;
    owner.append(text);
    layer.append(owner);
    return text;
  };
  const visible = (node, yes) => {
    const owner = node.parentElement.hasAttribute('data-label') ? node.parentElement : node;
    owner.style.opacity = yes ? '1' : '0';
  };
  const title = [addText('Откуда берётся', 'title'), addText('остаток?', 'title')];
  const countRow = [addText(count, 'number', colors.purple), addText('предмета')];
  const groupSize = addText(`по ${divisor}`, 'small', colors.blue);
  const groupCount = [
    addText(groupsCount, 'number', colors.blue),
    addText('групп', '', colors.blue),
  ];
  const product = [groupsCount, '×', divisor, '=', groupsCount * divisor].map((value) =>
    addText(value, 'number', colors.blue),
  );
  const answer = [count, '=', groupsCount * divisor, '+', remainder].map((value, i) =>
    addText(value, 'number', i === 0 ? colors.purple : i === 4 ? colors.orange : colors.blue),
  );
  const remainderNote = [
    addText(remainder, 'small', colors.orange),
    addText('остаток', 'small', colors.orange),
  ];
  const groupShapes = Array.from({ length: groupsCount }, (_, i) => {
    const outer = el('g', { 'data-group': i });
    const shape = rc.rectangle(-33, -28, 66, 56, {
      seed: 91 + i,
      roughness: 0.4,
      disableMultiStroke: true,
      stroke: colors.blue,
      strokeWidth: 1.5,
    });
    outer.append(shape);
    layer.prepend(outer);
    return { outer, shape };
  });
  const tokens = Array.from({ length: count }, (_, i) => {
    const outer = el('g', { 'data-token': i });
    const shape = rc.circle(0, 0, 17, {
      seed: 201 + i,
      roughness: 0.35,
      disableMultiStroke: true,
      stroke: 'var(--ve-pencil)',
      strokeWidth: 1.5,
      fill: 'var(--ve-wash)',
      fillStyle: 'solid',
    });
    outer.append(shape);
    layer.append(outer);
    return { outer, shape, pose: { x: 0, y: 0 } };
  });
  const missingSlot = el('circle', {
    r: 8.5,
    fill: 'none',
    stroke: 'var(--ve-pencil)',
    'stroke-width': 1.2,
    'stroke-dasharray': '2 3',
    'data-missing-slot': '',
  });
  layer.append(missingSlot);
  const productCues = [
    'product_groups',
    'product_sign',
    'product_size',
    'product_equals',
    'product_value',
  ];
  const answerCues = [
    'summary_whole',
    'summary_equals',
    'summary_grouped',
    'summary_plus',
    'summary_remainder',
  ];
  let animation, player;
  function render(frame) {
    const { time: t, reduced } = frame;
    if (!animation) return;
    animation.time(t, false);
    const p = frame.reveal;
    const reveal = (shape, amount) => {
      visible(shape, amount > 0);
      trace([...shape.querySelectorAll('path')], amount);
    };
    // Each written fact uses its own spoken cue; movement shares the audio clock.
    write(title[0], p('question_intro'));
    write(title[1], p('question_remainder'));
    countRow.forEach((node, i) => {
      write(node, p(i ? 'object_name' : 'object_count'));
      visible(node, !frame.has('group_count'));
    });
    write(groupSize, p('group_size'));
    visible(groupSize, !frame.has('group_count'));
    groupCount.forEach((node, i) => {
      write(node, p(i ? 'group_name' : 'group_count'));
      visible(node, !frame.has('product_groups'));
    });
    const grouping = frame.cue('group_action'),
      groupingDuration = grouping.end - grouping.start;
    groupShapes.forEach(({ shape }, i) => {
      const start = grouping.start + (groupingDuration * 0.4 * i) / (groupsCount - 1);
      const amount = reduced
        ? p('group_action')
        : progress(t, {
            start,
            end: start + groupingDuration * 0.6,
          });
      reveal(shape, amount);
    });
    tokens.forEach(({ outer, shape, pose }, i) => {
      const amount = reduced
        ? p('object_count')
        : Math.min(1, Math.max(0, p('number') * 1.5 - i * 0.022));
      outer.style.opacity = String(amount);
      const position = reduced ? (frame.has('group_action') ? pose.end : pose.start) : pose;
      outer.setAttribute('transform', `translate(${position.x} ${position.y})`);
      const leftover = i >= groupsCount * divisor && frame.has('remainder_value');
      shape
        .querySelectorAll('path[stroke]:not([stroke="none"])')
        .forEach((path) => path.setAttribute('stroke', leftover ? colors.orange : colors.blue));
      const example = i < divisor && frame.has('each_group') && !frame.finished('each_group');
      shape
        .querySelectorAll('path[fill]:not([fill="none"])')
        .forEach((path) =>
          path.setAttribute(
            'fill',
            leftover
              ? 'var(--ve-orange-soft)'
              : example
                ? 'var(--ve-blue-soft)'
                : 'var(--ve-blue-wash)',
          ),
        );
    });
    product.forEach((node, i) => {
      write(node, p(productCues[i]));
      visible(node, !frame.has('summary'));
    });
    answer.forEach((node, i) => write(node, p(answerCues[i])));
    remainderNote.forEach((node, i) => write(node, p(i ? 'remainder_name' : 'remainder_value')));
    visible(missingSlot, frame.has('missing_slot') && !frame.has('summary'));
    root.dataset.phase = timing.segments.findLast((segment) => t >= segment.start)?.id || 'intro';
  }
  const measured = await observe(svg, (width) => {
    animation?.kill();
    layer.querySelectorAll('[data-label]>text').forEach(resetText);
    const small = width < 420,
      columns = width < 520 ? 3 : 4;
    const cell = Math.min(130, (width - 24) / columns),
      rows = Math.ceil((groupsCount + 1) / columns);
    const top = 164,
      groupBottom = top + (rows - 1) * 84 + 28;
    title.forEach((node) => {
      const size = small ? 28 : 34;
      node.style.fontSize = `${size}px`;
      const measured = node.getComputedTextLength();
      if (measured > width - 16) node.style.fontSize = `${(size * (width - 16)) / measured}px`;
    });
    layer.querySelectorAll('text.number').forEach((node) => {
      node.style.fontSize = `${small ? 28 : 36}px`;
    });
    layer.querySelectorAll('text.small').forEach((node) => {
      node.style.fontSize = `${small ? 17 : 20}px`;
    });
    place(title[0], width / 2, 32);
    place(title[1], width / 2, 74);
    const targets = Array.from({ length: groupsCount + 1 }, (_, i) => ({
      x: width / 2 + ((i % columns) - (columns - 1) / 2) * cell,
      y: top + Math.floor(i / columns) * 84,
    }));
    groupShapes.forEach(({ outer }, i) =>
      outer.setAttribute('transform', `translate(${targets[i].x} ${targets[i].y})`),
    );
    place(groupSize, targets[0].x, targets[0].y - 44);
    const initialColumns = small ? 6 : 8,
      spacing = Math.min(36, (width - 30) / initialColumns);
    const duration = C.group_action.end - C.group_action.start;
    animation = gsap.timeline({ paused: true });
    tokens.forEach(({ pose }, i) => {
      const start = {
        x: width / 2 + ((i % initialColumns) - (initialColumns - 1) / 2) * spacing,
        y: top - 24 + Math.floor(i / initialColumns) * 28,
      };
      const group = Math.floor(i / divisor),
        target = targets[group];
      const end = { x: target.x + ((i % divisor) - 1) * 21, y: target.y };
      Object.assign(pose, start, { start, end });
      animation.fromTo(
        pose,
        start,
        { ...end, duration: duration * 0.6, ease: 'power2.inOut', immediateRender: false },
        C.group_action.start + (duration * 0.4 * group) / groupsCount,
      );
    });
    const last = targets[groupsCount];
    missingSlot.setAttribute('cx', last.x + (remainder - 1) * 21);
    missingSlot.setAttribute('cy', last.y);
    row(remainderNote, { x: last.x - 10, y: last.y + 44, gap: 7 });
    for (const nodes of [countRow, groupCount, product, answer])
      row(nodes, { x: width / 2, y: groupBottom + 76, gap: small ? 10 : 16 });
    player?.update();
    return groupBottom + 113;
  });
  player = story({ script: timing, audio, stateAt: (frame) => frame, render });
  const stops = [
    { time: 0, label: 'Откуда берётся остаток?' },
    { time: C.number.start, label: 'Берём предметы' },
    { time: C.grouping.start, label: 'Собираем одинаковые группы' },
    { time: C.product.start, label: 'Считаем полные группы' },
    { time: C.result.start, label: 'Рассматриваем оставшиеся предметы' },
    { time: C.summary.start, label: 'Записываем равенство' },
  ];
  const ui = storyPlayer(root.querySelector('[data-player]'), {
    transport: player.player,
    stops: stops.map((stop) => stop.time),
    onSeek: player.seek,
    captions: {
      element: root.querySelector('[data-caption]'),
      track: captionTrack({
        segments: stops.map(({ time, label }, i) => ({
          id: String(i),
          start: time,
          end: stops[i + 1]?.time ?? timing.duration,
          text: label,
        })),
      }),
    },
  });
  let disposed = false;
  mountScene(root, {
    get playing() {
      return player.player.state.playing;
    },
    duration: timing.duration,
    get currentTime() {
      return player.currentTime;
    },
    play: player.player.play,
    seek: player.seek,
    pause: player.pause,
    setReduced: player.setReduced,
    snapshot: () => ({ count, divisor, groupsCount, remainder, time: player.currentTime }),
    review: player.review,
    dispose() {
      if (disposed) return;
      disposed = true;
      ui.dispose();
      player.dispose();
      measured.dispose();
      animation?.kill();
      frame.dispose();
      root.replaceChildren();
    },
  });
})().catch((error) => {
  const caption = document.querySelector('[data-caption]');
  caption.classList.remove('sr-only');
  caption.setAttribute('role', 'alert');
  caption.textContent = error.message;
  throw error;
});
