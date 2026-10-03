import { fusionShape, type FusionShape, type FusionPose } from './shape.js';
import { fusionText } from './text.js';
import { textRoutes } from './text-routing.js';
import { inkRoutes } from './transport.js';
import { inkMotion, type InkVertices } from './motion.js';
import { inkDetailVisibility } from './detail.js';
import { fusionFragment, fusionVertex, strokeFragment, strokeVertex } from './shader.js';

export interface FusionFrame {
  sources: readonly [FusionPose, FusionPose];
  target?: FusionPose;
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
  let bounds = parent.getBoundingClientRect();
  let motion: ReturnType<typeof inkMotion> | undefined,
    details: ReturnType<typeof inkDetailVisibility> | undefined,
    ink = [0, 0, 0],
    textDetails = false,
    textScale = 1;
  let stroke: WebGLProgram, fusion: WebGLProgram;
  let quad: WebGLBuffer, segments: WebGLBuffer, visibility: WebGLBuffer;
  let strokeVAO: WebGLVertexArrayObject, fusionVAO: WebGLVertexArrayObject;
  let fields: { texture: WebGLTexture; buffer: WebGLFramebuffer }[] = [];
  let floatingFields = false;
  let surfaceWidth = 0,
    surfaceHeight = 0;
  let strokeUniforms: Record<string, WebGLUniformLocation | null>,
    fusionUniforms: Record<string, WebGLUniformLocation | null>;
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
    strokeUniforms = uniforms(stroke, ['resolution', 'world', 'band']);
    fusionUniforms = uniforms(fusion, ['resolution', 'world', 'band', 'tension', 'ink', 'details']);
    gl!.useProgram(fusion);
    gl!.uniform1i(gl!.getUniformLocation(fusion, 'first'), 0);
    gl!.uniform1i(gl!.getUniformLocation(fusion, 'second'), 1);
    fields = [0, 1].map(() => ({
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
        floatingFields ? gl!.RG16F : gl!.RG8,
        w,
        h,
        0,
        gl!.RG,
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
    previous = frame;
    previousVertices = deformed;
    if (lost || !motion) return;
    const target = frame.target ?? { x: 0, y: 0 };
    if (
      [...frame.sources, target].some(
        (p) =>
          !Number.isFinite(p.x + p.y + (p.scale ?? 1) + (p.rotation ?? 0)) || (p.scale ?? 1) <= 0,
      )
    )
      throw new Error('Fusion poses need finite coordinates and positive scales');
    if (!Number.isFinite((frame.morph ?? 0) + (frame.tension ?? 28)))
      throw new Error('Fusion progress and tension must be finite');
    const morph = Math.max(0, Math.min(1, frame.morph ?? 0));
    const tension = Math.max(0, Math.min(64, frame.tension ?? 28)) * textScale * (1 - morph) ** 2;
    const band = Math.max(8, tension + 2);
    const vertices = deformed ?? motion(frame.sources, target, morph);
    const detail = details!(
      vertices,
      morph,
      Math.max(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height)),
    );
    const ratio = Math.min(devicePixelRatio || 1, 2);
    resize(
      Math.max(1, Math.round(bounds.width * ratio)),
      Math.max(1, Math.round(bounds.height * ratio)),
    );
    gl!.useProgram(stroke);
    gl!.bindVertexArray(strokeVAO);
    gl!.uniform2f(strokeUniforms.resolution!, surfaceWidth, surfaceHeight);
    gl!.uniform2f(strokeUniforms.world!, width, height);
    gl!.uniform1f(strokeUniforms.band!, band);
    gl!.enable(gl!.BLEND);
    gl!.blendEquation(gl!.MIN);
    gl!.blendFunc(gl!.ONE, gl!.ONE);
    for (let i = 0; i < 2; i++) {
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fields[i]!.buffer);
      gl!.clearColor(1, 1, 1, 1);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, segments);
      gl!.bufferData(gl!.ARRAY_BUFFER, vertices[i]!, gl!.DYNAMIC_DRAW);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, visibility);
      gl!.bufferData(gl!.ARRAY_BUFFER, detail[i]!, gl!.DYNAMIC_DRAW);
      gl!.drawArraysInstanced(gl!.TRIANGLES, 0, 6, vertices[i]!.length / 6);
    }
    gl!.disable(gl!.BLEND);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.useProgram(fusion);
    gl!.bindVertexArray(fusionVAO);
    fields.forEach(({ texture }, i) => {
      gl!.activeTexture(gl!.TEXTURE0 + i);
      gl!.bindTexture(gl!.TEXTURE_2D, texture);
    });
    gl!.uniform2f(fusionUniforms.resolution!, surfaceWidth, surfaceHeight);
    gl!.uniform2f(fusionUniforms.world!, width, height);
    gl!.uniform1f(fusionUniforms.band!, band);
    gl!.uniform1f(fusionUniforms.tension!, tension);
    gl!.uniform3fv(fusionUniforms.ink!, ink);
    gl!.uniform1i(fusionUniforms.details!, textDetails && morph > 0 && morph < 1 ? 1 : 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 6);
  }
  const redraw = () => {
    if (previous) render(previous, previousVertices);
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
  const observer = new ResizeObserver(() => {
    bounds = parent.getBoundingClientRect();
    redraw();
  });
  observer.observe(parent);
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
    setShapes(first: FusionShape, second: FusionShape, target: FusionShape) {
      const allText = first.text && second.text && target.text;
      motion = inkMotion(
        allText
          ? textRoutes(first, second, target)
          : inkRoutes(first.paths, second.paths, target.paths),
      );
      details = inkDetailVisibility(motion.patches, Boolean(allText));
      textDetails = Boolean(allText);
      textScale = allText
        ? Math.min(
            1,
            ...[first, second, target].flatMap((shape) =>
              shape.text!.glyphs.map((g) => g.size / 126),
            ),
          )
        : 1;
      previous = undefined;
      previousVertices = undefined;
      return motion;
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
    dispose() {
      if (disposed) return;
      disposed = true;
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
      gl!.deleteProgram(stroke);
      gl!.deleteProgram(fusion);
      motion = undefined;
      details = undefined;
      previous = undefined;
      previousVertices = undefined;
      canvas.remove();
      probe.remove();
    },
  };
}
export const InkFusion = { mount: fusionSurface, text: fusionText, shape: fusionShape };
export type { FusionShape, FusionPose } from './shape.js';
