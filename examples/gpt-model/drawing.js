import {
  lettering,
  paragraph,
  object,
  svgButton,
  placeLabels,
  SvgLayout,
  describeObject,
  probabilityBar,
} from '@visual-storytelling/core';

// Subject geometry uses the public pen, lettering, hit-target and label owners.
export function drawing(view, { width, height, scale, compact }, input) {
  const disposers = [],
    obstacles = [],
    segments = [],
    fixedText = new Set(),
    labels = [],
    sequences = [];
  let sequence;
  const animate = (draw) => sequence?.draw.push(draw);
  const size = Math.max(compact ? 24 : 25, 16 / Math.max(scale, 0.1));
  const hit = Math.max(48, 44 / Math.max(scale, 0.1));
  const overflow = SvgLayout.overflow(view.layer);
  disposers.push(() => overflow.dispose());
  let id = 0;
  const group = (name, pigment = 'ink') => {
    const result = object(view.layer, name, pigment);
    if (sequence) {
      result.element.dataset.storyStep = sequence.name;
      animate((amount) => {
        result.element.style.visibility = amount > 0 ? '' : 'hidden';
      });
    }
    return result;
  };
  const text = (value, x, y, options = {}) => {
    const { pigment = 'ink', ...settings } = options;
    const g = group(`label-${++id}`, pigment);
    const label = lettering(g.content, value, {
      x,
      y,
      anchor: 'start',
      ...settings,
      size: Math.max(size, settings.size ?? size),
    });
    disposers.push(() => label.dispose());
    fixedText.add(label.element);
    animate((amount) => label.write(amount));
    return label;
  };
  const note = (value, x, y, maxWidth, options = {}) => {
    const g = group(`note-${++id}`, options.pigment ?? 'muted');
    const p = paragraph(g.content, { ...options, size: Math.max(size, options.size ?? size) });
    p.render(value, maxWidth, x + maxWidth / 2, y);
    disposers.push(() => p.dispose());
    fixedText.add(p.element);
    return p;
  };
  const line = (from, to, pigment = 'ink', arrow = false, thickness = 2) => {
    const g = group(`line-${++id}`, pigment);
    const mark = view.pen[arrow ? 'arrow' : 'line'](g.content, `stroke-${id}`, from, to, {
      width: thickness,
    });
    segments.push({ from, to, width: thickness });
    animate((amount) => mark.reveal(amount));
    return mark;
  };
  const box = (name, x, y, w, h, pigment = 'ink', fill = 'none') => {
    const g = group(name, pigment);
    const mark = view.pen.rect(g.content, `${name}-box`, x, y, w, h, { width: 1.6, fill });
    animate((amount) => mark.reveal(amount));
    obstacles.push({ x, y, width: w, height: h });
    return g;
  };
  const probability = (name, value, x, y, w, h, meaning) => {
    const g = group(`${name}-group`);
    const bar = probabilityBar({ ...view, layer: g.content }, name, value, {
      x,
      y,
      width: w,
      height: h,
      size: compact ? size : Math.max(size, 30),
      meaning,
    });
    disposers.push(bar.dispose);
    obstacles.push({ x, y, width: w, height: h });
    return bar;
  };
  const buttonDimensions = (bounds, w = 0, h = hit) => ({
    width: Math.max(w, hit, Math.ceil(bounds.width + 12)),
    height: Math.max(h, hit, Math.ceil(bounds.height + 12)),
  });
  const buttonSize = (label) => {
    const ink = lettering(view.layer, label, { size, minSize: size });
    try {
      return buttonDimensions(ink.bounds);
    } finally {
      ink.dispose();
    }
  };
  const button = (
    name,
    label,
    x,
    y,
    w,
    onPress,
    { pressed, pigment = 'ink', height: h = hit, outline = true, meaning } = {},
  ) => {
    const g = group(name, pigment);
    const ink = lettering(g.content, label, { size, minSize: size });
    const measured = ink.bounds;
    const dimensions = buttonDimensions(measured, w, h);
    x = Math.max(0, Math.min(width - dimensions.width, x - (dimensions.width - w) / 2));
    w = dimensions.width;
    h = dimensions.height;
    ink.at(
      x + w / 2 - (measured.x + measured.width / 2),
      y + h / 2 - (measured.y + measured.height / 2),
    );
    if (outline) {
      const mark = view.pen.rect(g.content, `${name}-button`, x, y, w, h, {
        fill: pressed ? 'marker' : 'none',
      });
      animate((amount) => mark.reveal(amount));
    }
    g.content.append(ink.element);
    ink.element.setAttribute('aria-hidden', 'true');
    disposers.push(() => ink.dispose());
    animate((amount) => ink.write(amount));
    const b = svgButton(g.content, { x, y, width: w, height: h, label, pressed, onPress });
    b.element.dataset.action = name;
    if (meaning) {
      b.element.dataset.object = name;
      disposers.push(describeObject(b.element, { label, ...meaning }));
    }
    obstacles.push({ x, y, width: w, height: h });
    disposers.push(() => b.dispose());
    return Object.assign(g, { bounds: { x, y, width: w, height: h } });
  };
  const annotation = (name, value, x, y, pigment = 'muted', priority = 1) => {
    const label = text(value, 0, 0, { pigment });
    fixedText.delete(label.element);
    const bounds = label.bounds;
    labels.push({
      label,
      name,
      value,
      x,
      y,
      width: bounds.width,
      height: bounds.height,
      priority,
      inkX: bounds.x,
      inkY: bounds.y,
    });
  };
  const explain = (element, id, meaning) => {
    element.setAttribute('data-object', id);
    disposers.push(describeObject(element, { interactive: false, ...meaning }));
  };
  const settle = () => {
    const reserved = SvgLayout.box(overflow.reserve());
    const placed = placeLabels(
      labels,
      { x: 12, y: 8, width: width - 24, height: height - 16 },
      {
        obstacles: [
          ...obstacles,
          ...[...fixedText].map((node) => SvgLayout.box(node, view.layer)),
          reserved,
        ],
        segments,
        gap: 10,
      },
    );
    placed.forEach((p, i) => {
      const l = labels[i];
      l.label.element.dataset.layoutLabel = l.name;
      l.label.element.dataset.layoutStatus = p.status;
      l.label.at(p.x - l.inkX, p.y - l.inkY);
      if (p.status === 'overflow') l.label.element.setAttribute('visibility', 'hidden');
    });
    overflow.update(
      labels
        .filter((_, i) => placed[i].status === 'overflow')
        .map((l) => ({ id: l.name, label: l.value })),
    );
  };
  return {
    width,
    height,
    compact,
    size,
    hit,
    detailActionY: height - 2 * hit - 32,
    text,
    note,
    line,
    box,
    probability,
    group,
    button,
    buttonSize,
    annotation,
    explain,
    settle,
    sequence(name, from, to, build) {
      const previous = sequence;
      sequence = { name, from, to, draw: [] };
      sequences.push(sequence);
      try {
        build();
      } finally {
        sequence = previous;
      }
    },
    render(frame, mode) {
      for (const { from, to, draw } of sequences) {
        const progress =
          mode === 'explore'
            ? 1
            : frame.reduced
              ? Number(frame.time >= from)
              : Math.max(0, Math.min(1, (frame.time - from) / (to - from)));
        draw.forEach((reveal) => reveal(progress));
      }
    },
    dispose() {
      disposers.forEach((dispose) => dispose());
      view.layer.replaceChildren();
    },
  };
}
