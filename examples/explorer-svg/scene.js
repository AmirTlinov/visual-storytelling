import { SvgLayout, SceneShell } from '@visual-storytelling/core';
import narrationTiming from './timeline.json' with { type: 'json' };
/* The shell is shared with explorer-3d; this file owns only the SVG subject. */
window.galleryReady = (async () => {
  await document.fonts.ready;
  const root = document.getElementById('ve-scene'), {element, place, box} = SvgLayout;
  let pose = {x: 3, y: 2, result: 1}, size = {width: 0, height: 0};
  const shell = SceneShell.mount(root, {
    title: 'Как складываются перемещения',
    parameters: [{key: 'x', label: 'По горизонтали', min: -3, max: 3, step: .5, value: 3}, {key: 'y', label: 'По вертикали', min: -3, max: 3, step: .5, value: 2}],
    onInput: values => render({...values, result: 1}),
    onMode: mode => {if (mode === 'explore') render({...shell.parameters, result: 1});}
  });
  shell.stage.style.height = '380px';
  const svg = element('svg', {class: 'canvas', role: 'img', 'aria-label': 'Два последовательных перемещения и их сумма'});
  svg.append(element('title', {}, 'Сложение перемещений'), element('desc', {}, 'Синий путь идёт по горизонтали, оранжевый продолжает его по вертикали; фиолетовая стрелка соединяет начало и конец.'));
  shell.stage.append(svg);
  function arrow(tone) {
    const group = element('g', {fill: 'none', stroke: `var(--ve-${tone})`, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'});
    const path = element('path'), head = element('path'); group.append(path, head); svg.append(group);
    return {group, draw(a, b, amount = 1) {
      const p = [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount], angle = Math.atan2(p[1] - a[1], p[0] - a[0]);
      group.style.visibility = Math.hypot(p[0] - a[0], p[1] - a[1]) < 2 ? 'hidden' : 'visible';
      path.setAttribute('d', `M${a} L${p}`);
      head.setAttribute('d', `M${p[0] - 9 * Math.cos(angle - .45)},${p[1] - 9 * Math.sin(angle - .45)} L${p} L${p[0] - 9 * Math.cos(angle + .45)},${p[1] - 9 * Math.sin(angle + .45)}`);
    }};
  }
  const horizontal = arrow('blue'), vertical = arrow('orange'), result = arrow('purple');
  result.group.setAttribute('stroke-width', '2.5');
  const start = element('circle', {r: 3.5, fill: 'var(--ve-ink)'}), end = element('circle', {r: 3.5, fill: 'var(--ve-purple)'}); svg.append(start, end);
  function label(color) {const text = element('text', {fill: 'currentColor', 'font-size': 18, style: `color:var(--ve-${color});paint-order:stroke;stroke:var(--ve-surface);stroke-width:4px;stroke-linejoin:round`}); svg.append(text); return text;}
  const originLabel = label('muted'), xLabel = label('blue'), yLabel = label('orange'), endLabel = label('purple');
  function put(text, value, x, y) {text.textContent = value; const width = box(text).width; place(text, Math.max(width / 2 + 5, Math.min(size.width - width / 2 - 5, x)), Math.max(16, Math.min(size.height - 16, y)));}
  function render(next = pose) {
    pose = next;
    const w = shell.stage.clientWidth, h = shell.stage.clientHeight;
    if (!w || !h) return;
    size = {width: w, height: h}; svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const unit = Math.min((w - 135) / 6, (h - 120) / 6), o = [w / 2, h / 2], a = [o[0] + pose.x * unit, o[1]], b = [a[0], o[1] - pose.y * unit];
    const stageBounds = shell.stage.getBoundingClientRect(), rootBounds = root.getBoundingClientRect();
    root.style.setProperty('--ve-grid-step', `${unit}px`);
    root.style.setProperty('--ve-grid-x', `${stageBounds.x - rootBounds.x + o[0]}px`);
    root.style.setProperty('--ve-grid-y', `${stageBounds.y - rootBounds.y + o[1]}px`);
    horizontal.draw(o, a); vertical.draw(a, b); result.draw(o, b, pose.result);
    start.setAttribute('cx', o[0]); start.setAttribute('cy', o[1]); end.setAttribute('cx', b[0]); end.setAttribute('cy', b[1]);
    put(originLabel, 'Начало', o[0] - 30, o[1] + (pose.y >= 0 ? 27 : -27));
    const number = n => Number(Math.abs(n).toFixed(1));
    put(xLabel, `${number(pose.x)} ${w < 480 ? (pose.x >= 0 ? '→' : '←') : (pose.x >= 0 ? 'вправо' : 'влево')}`, (o[0] + a[0]) / 2, o[1] + (pose.y >= 0 ? 27 : -27));
    xLabel.style.visibility = Math.abs(pose.x) < .15 ? 'hidden' : 'visible';
    put(yLabel, `${number(pose.y)} ${w < 480 ? (pose.y >= 0 ? '↑' : '↓') : (pose.y >= 0 ? 'вверх' : 'вниз')}`, a[0] + (pose.x >= 0 ? 52 : -52), (a[1] + b[1]) / 2);
    yLabel.style.visibility = Math.abs(pose.y) < .15 ? 'hidden' : 'visible';
    put(endLabel, `(${Number(pose.x.toFixed(1))}; ${Number(pose.y.toFixed(1))})`, b[0], b[1] + (pose.y >= 0 ? -25 : 25));
    endLabel.style.visibility = pose.result > .95 && Math.hypot(pose.x, pose.y) > .1 ? 'visible' : 'hidden';
    originLabel.style.visibility = Math.hypot(pose.x, pose.y) < .15 ? 'visible' : 'hidden';
  }
  const tip = document.createElement('p'); tip.textContent = 'Одна клетка — один шаг'; shell.actions.append(tip);
  const timing = narrationTiming;
  const story = shell.attachStory({audio: root.querySelector('[data-audio]'), timing,
    render(time, cues, reduced) {
      const phase = id => reduced ? Number(time >= cues.cue(id).start) : cues.progress(id, time);
      const values = {x: 3 * phase('move_x'), y: 2 * phase('move_y')}; shell.setParameters(values); render({...values, result: phase('result_arrow')});
    }
  });
  const observer = new ResizeObserver(() => render()); observer.observe(shell.stage); render();
  root.scene = {seek: story.seek, pause: story.pause, review: story.review, shell, story, dispose() {observer.disconnect(); shell.dispose();}};
})();
