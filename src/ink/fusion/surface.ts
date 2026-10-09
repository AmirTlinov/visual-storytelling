import { fusionShape, type FusionShape, type FusionPose } from './shape.js';
import { fusionText } from './text.js';
import { compileInkMotion, type InkVertices } from './motion.js';
import { inkDetailVisibility } from './detail.js';
import {
  composeInkField,
  inkGeometry,
  type FusionGeometry,
  type InkFieldFrame,
} from './geometry.js';
export type { FusionGeometry } from './geometry.js';
import {
  combineFragment,
  fusionFragment,
  fusionVertex,
  strokeFragment,
  strokeVertex,
} from './shader.js';

export interface FusionFrame {
  sources: readonly FusionPose[];
  targets: readonly FusionPose[];
  /** Direct transport from the input strokes (0) to the result strokes (1). */
  morph?: number;
  /** Local contact distance in scene units. Zero gives a hard union. */
  tension?: number;
}
export interface FusionOptions {
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}

/** A demand-rendered ink surface. Correspondences belong here; time belongs to the caller. */
export function fusionSurface(parent: HTMLElement, options: FusionOptions = {}) {
  let width = options.width ?? 840,
    height = options.height ?? 300;
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height))
    throw new Error('Fusion scene dimensions must be positive and finite');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', options.label ?? 'Слияние рисованных форм');
  parent.append(canvas);
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) {
    canvas.remove();
    throw new Error('Для слияния чернил требуется WebGL 2');
  }
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:${options.color ?? 'var(--ve-ink)'}`;
  parent.append(probe);
  const colorContext = document.createElement('canvas').getContext('2d')!;
  const abort = new AbortController();
  let disposed = false,
    lost = false,
    previous: FusionFrame | undefined,
    previousVertices: InkVertices | undefined;
  let previousField: InkFieldFrame | undefined,
    fieldOrigin: readonly [number, number] = [0, 0];
  const noMarks = { segments: new Float32Array(), visibility: new Float32Array() };
  let bounds = parent.getBoundingClientRect();
  let motion: ReturnType<typeof compileInkMotion> | undefined,
    details: ReturnType<typeof inkDetailVisibility> | undefined,
    ink = [0, 0, 0],
    textDetails = false,
    textScale = 1;
  let geometry: FusionGeometry | undefined,
    revision = 0,
    frameKey = '',
    vertexHash = 0;
  const changes = new Set<(geometry: FusionGeometry) => void>();
  const disposal = new Set<() => void>();
  let stroke: WebGLProgram, fusion: WebGLProgram, combine: WebGLProgram;
  let quad: WebGLBuffer, segments: WebGLBuffer, visibility: WebGLBuffer;
  let strokeVAO: WebGLVertexArrayObject,
    fusionVAO: WebGLVertexArrayObject,
    combineVAO: WebGLVertexArrayObject;
  let fields: { texture: WebGLTexture; buffer: WebGLFramebuffer }[] = [];
  let floatingFields = false;
  let surfaceWidth = 0,
    surfaceHeight = 0;
  let strokeUniforms: Record<string, WebGLUniformLocation | null>,
    fusionUniforms: Record<string, WebGLUniformLocation | null>,
    combineUniforms: Record<string, WebGLUniformLocation | null>;
  function program(vertex: string, fragment: string) {
    const result = gl!.createProgram()!;
    for (const [type, source] of [
      [gl!.VERTEX_SHADER, vertex],
      [gl!.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl!.createShader(type)!;
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        const message = gl!.getShaderInfoLog(shader);
        gl!.deleteShader(shader);
        gl!.deleteProgram(result);
        throw new Error(message ?? 'Could not compile ink fusion');
      }
      gl!.attachShader(result, shader);
      gl!.deleteShader(shader);
    }
    gl!.linkProgram(result);
    if (!gl!.getProgramParameter(result, gl!.LINK_STATUS))
      throw new Error(gl!.getProgramInfoLog(result) ?? 'Could not link ink fusion');
    return result;
  }
  function setup() {
    floatingFields = Boolean(gl!.getExtension('EXT_color_buffer_float'));
    stroke = program(strokeVertex, strokeFragment);
    fusion = program(fusionVertex, fusionFragment);
    combine = program(fusionVertex, combineFragment);
    quad = gl!.createBuffer()!;
    segments = gl!.createBuffer()!;
    visibility = gl!.createBuffer()!;
    gl!.bindBuffer(gl!.ARRAY_BUFFER, quad);
    gl!.bufferData(
      gl!.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl!.STATIC_DRAW,
    );
    function vao(p: WebGLProgram) {
      const result = gl!.createVertexArray()!;
      gl!.bindVertexArray(result);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, quad);
      const corner = gl!.getAttribLocation(p, 'corner');
      gl!.enableVertexAttribArray(corner);
      gl!.vertexAttribPointer(corner, 2, gl!.FLOAT, false, 0, 0);
      return result;
    }
    fusionVAO = vao(fusion);
    combineVAO = vao(combine);
    strokeVAO = vao(stroke);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, segments);
    for (const [name, size, offset] of [
      ['ends', 4, 0],
      ['radii', 2, 16],
    ] as const) {
      const at = gl!.getAttribLocation(stroke, name);
      gl!.enableVertexAttribArray(at);
      gl!.vertexAttribPointer(at, size, gl!.FLOAT, false, 24, offset);
      gl!.vertexAttribDivisor(at, 1);
    }
    gl!.bindBuffer(gl!.ARRAY_BUFFER, visibility);
    const detail = gl!.getAttribLocation(stroke, 'detailVisibility');
    gl!.enableVertexAttribArray(detail);
    gl!.vertexAttribPointer(detail, 1, gl!.FLOAT, false, 4, 0);
    gl!.vertexAttribDivisor(detail, 1);
    const uniforms = (p: WebGLProgram, names: string[]) =>
      Object.fromEntries(names.map((name) => [name, gl!.getUniformLocation(p, name)]));
    strokeUniforms = uniforms(stroke, ['resolution', 'world', 'band', 'origin', 'annotation']);
    fusionUniforms = uniforms(fusion, ['resolution', 'world', 'band', 'ink', 'details']);
    combineUniforms = uniforms(combine, ['band', 'tension']);
    gl!.useProgram(fusion);
    gl!.uniform1i(gl!.getUniformLocation(fusion, 'field'), 0);
    gl!.useProgram(combine);
    gl!.uniform1i(gl!.getUniformLocation(combine, 'first'), 0);
    gl!.uniform1i(gl!.getUniformLocation(combine, 'second'), 1);
    fields = [0, 1, 2].map(() => ({
      texture: gl!.createTexture()!,
      buffer: gl!.createFramebuffer()!,
    }));
    surfaceWidth = 0;
    surfaceHeight = 0;
  }
  function resize(w: number, h: number) {
    if (w === surfaceWidth && h === surfaceHeight) return;
    surfaceWidth = canvas.width = w;
    surfaceHeight = canvas.height = h;
    gl!.viewport(0, 0, w, h);
    fields.forEach(({ texture, buffer }) => {
      gl!.bindTexture(gl!.TEXTURE_2D, texture);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.texImage2D(
        gl!.TEXTURE_2D,
        0,
        floatingFields ? gl!.RGBA16F : gl!.RGBA8,
        w,
        h,
        0,
        gl!.RGBA,
        floatingFields ? gl!.HALF_FLOAT : gl!.UNSIGNED_BYTE,
        null,
      );
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, buffer);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, texture, 0);
      if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE)
        throw new Error('Could not allocate ink surface');
    });
  }
  function render(frame: FusionFrame, deformed?: InkVertices) {
    if (disposed) return;
    if (!motion) return;
    if (frame.sources.length !== motion.sourceCount || frame.targets.length !== motion.targetCount)
      throw new Error('Fusion poses must match source and target shape counts');
    for (const p of [...frame.sources, ...frame.targets])
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.rotation ?? 0) ||
        !Number.isFinite(p.scale ?? 1) ||
        (p.scale ?? 1) <= 0
      )
        throw new Error('Fusion poses need finite coordinates and positive scales');
    if (!Number.isFinite(frame.morph ?? 0) || !Number.isFinite(frame.tension ?? 28))
      throw new Error('Fusion progress and tension must be finite');
    const morph = Math.max(0, Math.min(1, frame.morph ?? 0));
    const tension = Math.max(0, Math.min(64, frame.tension ?? 28)) * textScale * (1 - morph) ** 2;
    const vertices = deformed ?? motion(frame.sources, frame.targets, morph);
    if (vertices.length !== motion.sourceCount)
      throw new Error('Fusion segment buffers must match source shapes');
    const nextKey = JSON.stringify(frame);
    // Elastic tracks reuse their buffers. Hash their bits without copying the geometry.
    let hash = 2166136261;
    if (deformed)
      for (const values of vertices) {
        const bits = new Uint32Array(values.buffer, values.byteOffset, values.length);
        for (const value of bits) hash = Math.imul(hash ^ value, 16777619);
      }
    const changed = nextKey !== frameKey || hash !== vertexHash;
    previous = frame;
    previousVertices = deformed;
    frameKey = nextKey;
    vertexHash = hash;
    const detail = details!(
      vertices,
      morph,
      Math.max(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height)),
    );
    if (changed) geometry = inkGeometry(vertices, detail, motion.patches, tension, ++revision);
    previousField = undefined;
    fieldOrigin = [0, 0];
    if (lost) return;
    drawField({
      segments: vertices,
      visibility: detail,
      groups: [{ start: 0, end: vertices.length, tension }],
      details: textDetails && morph > 0 && morph < 1,
      marks: noMarks,
      label: '',
    });
    if (changed) for (const listener of changes) listener(geometry!);
  }
  function drawField(data: InkFieldFrame) {
    if (disposed || lost) return;
    const pixel = Math.max(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height));
    const band = Math.max(pixel * 8, ...data.groups.map((group) => group.tension + pixel * 2));
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (data.groups.length > 1 && fields.length === 3) {
      fields.push({ texture: gl!.createTexture()!, buffer: gl!.createFramebuffer()! });
      surfaceWidth = 0; // Allocate the extra field at the current resolution, once.
    }
    resize(
      Math.max(1, Math.round(bounds.width * ratio)),
      Math.max(1, Math.round(bounds.height * ratio)),
    );
    gl!.useProgram(stroke);
    gl!.uniform2f(strokeUniforms.origin!, fieldOrigin[0], fieldOrigin[1]);
    gl!.uniform1i(strokeUniforms.annotation!, 0);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fields[0]!.buffer);
    gl!.clearColor(1, 1, 1, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    const aggregate = composeInkField(
      data.groups,
      (i, target) => {
        gl!.useProgram(stroke);
        gl!.bindVertexArray(strokeVAO);
        gl!.uniform2f(strokeUniforms.resolution!, surfaceWidth, surfaceHeight);
        gl!.uniform2f(strokeUniforms.world!, width, height);
        gl!.uniform1f(strokeUniforms.band!, band);
        gl!.enable(gl!.BLEND);
        gl!.blendEquation(gl!.MIN);
        gl!.blendFunc(gl!.ONE, gl!.ONE);
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, fields[target]!.buffer);
        gl!.clearColor(1, 1, 1, 1);
        gl!.clear(gl!.COLOR_BUFFER_BIT);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, segments);
        gl!.bufferData(gl!.ARRAY_BUFFER, data.segments[i]!, gl!.DYNAMIC_DRAW);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, visibility);
        gl!.bufferData(gl!.ARRAY_BUFFER, data.visibility[i]!, gl!.DYNAMIC_DRAW);
        gl!.drawArraysInstanced(gl!.TRIANGLES, 0, 6, data.segments[i]!.length / 6);
        gl!.disable(gl!.BLEND);
      },
      (first, second, target, tension) => {
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, fields[target]!.buffer);
        gl!.useProgram(combine);
        gl!.bindVertexArray(combineVAO);
        gl!.activeTexture(gl!.TEXTURE0);
        gl!.bindTexture(gl!.TEXTURE_2D, fields[first]!.texture);
        gl!.activeTexture(gl!.TEXTURE1);
        gl!.bindTexture(gl!.TEXTURE_2D, fields[second]!.texture);
        gl!.uniform1f(combineUniforms.band!, band);
        gl!.uniform1f(combineUniforms.tension!, tension);
        gl!.drawArrays(gl!.TRIANGLES, 0, 6);
      },
    );
    if (data.marks.segments.length) {
      gl!.useProgram(stroke);
      gl!.bindVertexArray(strokeVAO);
      gl!.uniform2f(strokeUniforms.resolution!, surfaceWidth, surfaceHeight);
      gl!.uniform2f(strokeUniforms.world!, width, height);
      gl!.uniform1f(strokeUniforms.band!, band);
      gl!.uniform1i(strokeUniforms.annotation!, 1);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fields[aggregate]!.buffer);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, segments);
      gl!.bufferData(gl!.ARRAY_BUFFER, data.marks.segments, gl!.DYNAMIC_DRAW);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, visibility);
      gl!.bufferData(gl!.ARRAY_BUFFER, data.marks.visibility, gl!.DYNAMIC_DRAW);
      gl!.enable(gl!.BLEND);
      gl!.blendEquation(gl!.MIN);
      gl!.blendFunc(gl!.ONE, gl!.ONE);
      gl!.drawArraysInstanced(gl!.TRIANGLES, 0, 6, data.marks.segments.length / 6);
      gl!.disable(gl!.BLEND);
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.useProgram(fusion);
    gl!.bindVertexArray(fusionVAO);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, fields[aggregate]!.texture);
    gl!.uniform2f(fusionUniforms.resolution!, surfaceWidth, surfaceHeight);
    gl!.uniform2f(fusionUniforms.world!, width, height);
    gl!.uniform1f(fusionUniforms.band!, band);
    gl!.uniform3fv(fusionUniforms.ink!, ink);
    gl!.uniform1i(fusionUniforms.details!, data.details ? 1 : 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 6);
  }
  function renderField(
    data: InkFieldFrame,
    layout: { width: number; height: number; origin?: readonly [number, number] },
  ) {
    if (disposed) return;
    if (!(layout.width > 0 && layout.height > 0) || !Number.isFinite(layout.width + layout.height))
      throw new Error('Ink field dimensions must be positive and finite');
    width = layout.width;
    height = layout.height;
    bounds = parent.getBoundingClientRect();
    previousField = data;
    fieldOrigin = layout.origin ?? [0, 0];
    canvas.setAttribute('aria-label', data.label);
    drawField(data);
  }
  const redraw = () => {
    if (previousField) drawField(previousField);
    else if (previous) render(previous, previousVertices);
  };
  function theme() {
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = getComputedStyle(probe).color;
    colorContext.fillRect(0, 0, 1, 1);
    const pixel = colorContext.getImageData(0, 0, 1, 1).data;
    ink = [pixel[0]! / 255, pixel[1]! / 255, pixel[2]! / 255];
    redraw();
  }
  setup();
  theme();
  const resizeSurface = () => {
    const next = parent.getBoundingClientRect();
    if (next.width === bounds.width && next.height === bounds.height) return;
    bounds = next;
    frameKey = '';
    redraw();
  };
  const observer = new ResizeObserver(resizeSurface);
  observer.observe(parent);
  for (
    let frame = parent.closest('[data-scene-frame]');
    frame;
    frame = frame.parentElement?.closest('[data-scene-frame]') ?? null
  ) {
    const owner = frame;
    owner.addEventListener(
      'scene-frame-resize',
      (event) => {
        if (event.target === owner) resizeSurface();
      },
      { signal: abort.signal },
    );
  }
  const appearance = new MutationObserver(theme);
  for (const node of [document.documentElement, parent.closest('.ve-scene')])
    if (node)
      appearance.observe(node, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-theme'],
      });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme, {
    signal: abort.signal,
  });
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      lost = true;
    },
    { signal: abort.signal },
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      lost = false;
      setup();
      redraw();
    },
    { signal: abort.signal },
  );
  return {
    canvas,
    setShapes(sources: readonly FusionShape[], targets: readonly FusionShape[]) {
      if (disposed) throw new Error('Fusion surface has been disposed');
      const shapes = [...sources, ...targets];
      if (!sources.length || !targets.length || shapes.some((shape) => !shape.paths?.length))
        throw new Error('Fusion needs visible source and target shapes');
      const allText = shapes.every((shape) => shape.text);
      const next = compileInkMotion(sources, targets);
      motion = next;
      details = inkDetailVisibility(motion.patches, allText);
      textDetails = allText;
      textScale = allText
        ? Math.min(1, ...shapes.flatMap((shape) => shape.text!.glyphs.map((g) => g.size / 126)))
        : 1;
      previous = undefined;
      previousVertices = undefined;
      frameKey = '';
      previousField = undefined;
      return motion;
    },
    get geometry() {
      return geometry;
    },
    onChange(listener: (geometry: FusionGeometry) => void) {
      if (disposed) throw new Error('Fusion surface has been disposed');
      if (geometry) listener(geometry);
      if (disposed) throw new Error('Fusion surface has been disposed');
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
    onDispose(listener: () => void) {
      if (disposed) throw new Error('Fusion surface has been disposed');
      disposal.add(listener);
      return () => {
        disposal.delete(listener);
      };
    },
    setSize(w: number, h: number) {
      if (!(w > 0 && h > 0) || !Number.isFinite(w + h))
        throw new Error('Fusion scene dimensions must be positive and finite');
      width = w;
      height = h;
      bounds = parent.getBoundingClientRect();
      redraw();
    },
    render,
    renderField,
    snapshot() {
      if (disposed) throw new Error('Fusion surface has been disposed');
      redraw();
      return canvas.toDataURL('image/png');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const listener of disposal) listener();
      disposal.clear();
      changes.clear();
      geometry = undefined;
      abort.abort();
      observer.disconnect();
      appearance.disconnect();
      fields.forEach(({ texture, buffer }) => {
        gl!.deleteTexture(texture);
        gl!.deleteFramebuffer(buffer);
      });
      gl!.deleteBuffer(quad);
      gl!.deleteBuffer(segments);
      gl!.deleteBuffer(visibility);
      gl!.deleteVertexArray(strokeVAO);
      gl!.deleteVertexArray(fusionVAO);
      gl!.deleteVertexArray(combineVAO);
      gl!.deleteProgram(stroke);
      gl!.deleteProgram(fusion);
      gl!.deleteProgram(combine);
      motion = undefined;
      details = undefined;
      previous = undefined;
      previousVertices = undefined;
      previousField = undefined;
      canvas.remove();
      probe.remove();
    },
  };
}
export const InkFusion = { mount: fusionSurface, text: fusionText, shape: fusionShape };
export type { FusionShape, FusionPose } from './shape.js';
