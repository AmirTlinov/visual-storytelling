import { areaThresholds, tensionUnion, relaxField, relaxationAt } from './field.js';
import {
  fusionShape,
  fusionText,
  sampleShape,
  type FusionShape,
  type FusionPose,
} from './shape.js';
import { fusionFragment, fusionVertex } from './shader.js';

export interface FusionFrame {
  sources: readonly [FusionPose, FusionPose];
  target?: FusionPose;
  /** 0: contacting source silhouettes; 1: the exact destination silhouette. */
  morph?: number;
  /** Interaction distance in scene units. Zero gives a hard union. */
  tension?: number;
}
export interface FusionOptions {
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}

/** A demand-rendered implicit ink surface. The caller owns poses and time. */
export function fusionSurface(parent: HTMLElement, options: FusionOptions = {}) {
  const width = options.width ?? 840,
    height = options.height ?? 300;
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height))
    throw new Error('Fusion scene dimensions must be positive and finite');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', options.label ?? 'Слияние рисованных форм');
  parent.append(canvas);
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) {
    canvas.remove();
    throw new Error('Для слияния чернил требуется WebGL');
  }
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:${options.color ?? 'var(--ve-ink)'}`;
  parent.append(probe);
  const colorContext = document.createElement('canvas').getContext('2d')!;
  const abort = new AbortController();
  let disposed = false,
    lost = false;
  let program: WebGLProgram, buffer: WebGLBuffer;
  let locations: Record<string, WebGLUniformLocation | null>;
  let textures: WebGLTexture[] = [];
  let shapes: readonly [FusionShape, FusionShape, FusionShape] | undefined;
  let previous: FusionFrame | undefined,
    thresholdKey = '';
  let thresholds: Float32Array = new Float32Array(49);
  let ink = [0, 0, 0];

  function setup() {
    const shaders = [
      [gl!.VERTEX_SHADER, fusionVertex],
      [gl!.FRAGMENT_SHADER, fusionFragment],
    ] as const;
    program = gl!.createProgram()!;
    for (const [type, source] of shaders) {
      const shader = gl!.createShader(type)!;
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        const message = gl!.getShaderInfoLog(shader);
        gl!.deleteShader(shader);
        gl!.deleteProgram(program);
        throw new Error(message ?? 'Could not compile ink fusion');
      }
      gl!.attachShader(program, shader);
      gl!.deleteShader(shader);
    }
    gl!.linkProgram(program);
    if (!gl!.getProgramParameter(program, gl!.LINK_STATUS))
      throw new Error(gl!.getProgramInfoLog(program) ?? 'Could not link ink fusion');
    gl!.useProgram(program);
    buffer = gl!.createBuffer()!;
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    gl!.bufferData(
      gl!.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl!.STATIC_DRAW,
    );
    const attribute = gl!.getAttribLocation(program, 'position');
    gl!.enableVertexAttribArray(attribute);
    gl!.vertexAttribPointer(attribute, 2, gl!.FLOAT, false, 0, 0);
    locations = Object.fromEntries(
      [
        'resolution',
        'world',
        'ink',
        'tension',
        'morph',
        'level',
        'relaxation',
        'sizes[0]',
        'poses[0]',
      ].map((name) => [name, gl!.getUniformLocation(program, name)]),
    );
    textures = ['first', 'second', 'target', 'relaxedFirst', 'relaxedTarget'].map((name, i) => {
      gl!.uniform1i(gl!.getUniformLocation(program, name), i);
      return gl!.createTexture()!;
    });
    for (let i = 3; i < 5; i++) uploadField(i, new Float32Array(1), 1, 1);
  }
  function uploadField(i: number, distances: Float32Array, w: number, h: number) {
    const packed = new Uint8Array(distances.length * 4);
    distances.forEach((distance, j) => {
      const value = Math.round(Math.max(0, Math.min(1, distance / 512 + 0.5)) * 65535);
      packed[j * 4] = value >> 8;
      packed[j * 4 + 1] = value & 255;
      packed[j * 4 + 3] = 255;
    });
    gl!.activeTexture(gl!.TEXTURE0 + i);
    gl!.bindTexture(gl!.TEXTURE_2D, textures[i]!);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, packed);
  }
  function upload() {
    if (!shapes || disposed || lost) return;
    shapes.forEach((shape, i) =>
      uploadField(i, shape.distance, shape.pixelsWide, shape.pixelsHigh),
    );
    gl!.uniform2fv(
      locations['sizes[0]']!,
      shapes.flatMap((shape) => [shape.width, shape.height]),
    );
  }
  function prepare(frame: FusionFrame, poses: readonly FusionPose[], tension: number) {
    const key = JSON.stringify([poses, tension]);
    if (key === thresholdKey || !shapes || !(frame.morph! > 0 && frame.morph! < 1)) return;
    // A compact quadrature computes the required ink area once per transition.
    const columns = Math.ceil(width / 1.5),
      rows = Math.ceil(height / 1.5);
    const from = new Float32Array(columns * rows),
      to = new Float32Array(from.length);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const px = ((x + 0.5) / columns) * width - width / 2;
        const py = ((y + 0.5) / rows) * height - height / 2;
        const a = sampleShape(shapes[0], poses[0]!, px, py),
          b = sampleShape(shapes[1], poses[1]!, px, py);
        from[y * columns + x] = tensionUnion(a, b, tension);
        to[y * columns + x] = sampleShape(shapes[2], poses[2]!, px, py);
      }
    const relaxed = [relaxField(from, columns, 5), relaxField(to, columns, 5)] as const;
    thresholds = areaThresholds(from, to, 49, relaxed);
    uploadField(3, relaxed[0], columns, rows);
    uploadField(4, relaxed[1], columns, rows);
    thresholdKey = key;
  }
  function render(frame: FusionFrame) {
    previous = frame;
    if (disposed || lost || !shapes) return;
    const poses = [...frame.sources, frame.target ?? { x: 0, y: 0 }];
    if (
      poses.some(
        (pose) =>
          !Number.isFinite(pose.x + pose.y + (pose.rotation ?? 0) + (pose.scale ?? 1)) ||
          !((pose.scale ?? 1) > 0),
      )
    )
      throw new Error('Fusion poses need finite coordinates and positive scales');
    if (!Number.isFinite((frame.morph ?? 0) + (frame.tension ?? 28)))
      throw new Error('Fusion progress and tension must be finite');
    const morph = Math.max(0, Math.min(1, frame.morph ?? 0));
    const tension = Math.max(0, frame.tension ?? 28);
    prepare(frame, poses, tension);
    const at = morph * (thresholds.length - 1),
      index = Math.floor(at);
    const level =
      morph === 0 || morph === 1
        ? 0
        : thresholds[index]! * (1 - (at - index)) +
          thresholds[Math.min(index + 1, thresholds.length - 1)]! * (at - index);
    const bounds = parent.getBoundingClientRect(),
      ratio = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(bounds.width * ratio)),
      h = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl!.viewport(0, 0, w, h);
    }
    gl!.uniform2f(locations.resolution!, w, h);
    gl!.uniform2f(locations.world!, width, height);
    gl!.uniform3fv(locations.ink!, ink);
    gl!.uniform1f(locations.morph!, morph);
    gl!.uniform1f(locations.tension!, tension);
    gl!.uniform1f(locations.level!, level);
    gl!.uniform1f(locations.relaxation!, relaxationAt(morph));
    gl!.uniform4fv(
      locations['poses[0]']!,
      poses.flatMap((pose) => [pose.x, pose.y, pose.scale ?? 1, pose.rotation ?? 0]),
    );
    gl!.drawArrays(gl!.TRIANGLES, 0, 6);
  }
  const redraw = () => {
    if (previous) render(previous);
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
  const resize = new ResizeObserver(redraw);
  resize.observe(parent);
  const appearance = new MutationObserver(theme);
  appearance.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-theme'],
  });
  const scene = parent.closest('.ve-scene');
  if (scene)
    appearance.observe(scene, {
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
      thresholdKey = '';
      setup();
      upload();
      redraw();
    },
    { signal: abort.signal },
  );
  return {
    canvas,
    setShapes(first: FusionShape, second: FusionShape, target: FusionShape) {
      shapes = [first, second, target];
      thresholdKey = '';
      upload();
    },
    /** Warm the area correction before playback; use the poses at the start of morphing. */
    prepare(frame: FusionFrame) {
      prepare(
        { ...frame, morph: 0.5 },
        [...frame.sources, frame.target ?? { x: 0, y: 0 }],
        frame.tension ?? 28,
      );
    },
    render,
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      resize.disconnect();
      appearance.disconnect();
      textures.forEach((texture) => gl!.deleteTexture(texture));
      gl!.deleteBuffer(buffer);
      gl!.deleteProgram(program);
      shapes = undefined;
      previous = undefined;
      canvas.remove();
      probe.remove();
    },
  };
}
export const InkFusion = { mount: fusionSurface, text: fusionText, shape: fusionShape };
export type { FusionShape, FusionPose } from './shape.js';
