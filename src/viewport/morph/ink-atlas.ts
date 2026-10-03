import {
  BufferGeometry,
  Camera,
  Color,
  CustomBlending,
  DoubleSide,
  Float32BufferAttribute,
  GLSL3,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  MinEquation,
  NoBlending,
  OneFactor,
  RawShaderMaterial,
  Scene,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import {
  strokeVertex,
  strokeFragment,
  fusionVertex,
  combineFragment,
} from '../../ink/fusion/shader.js';
import type { InkFieldFrame } from '../../ink/fusion/geometry.js';

const glsl = (source: string) => source.replace('#version 300 es', '');
/** The existing ink field, rendered into the solid's material with the same GPU and shaders. */
export function inkAtlas(renderer: WebGLRenderer) {
  const resolution = new Vector2(),
    world = new Vector2(),
    region = new Vector4();
  const uniforms = {
    resolution: { value: resolution },
    world: { value: world },
    band: { value: 1 },
    tension: { value: 0 },
    first: { value: null as WebGLRenderTarget['texture'] | null },
    second: { value: null as WebGLRenderTarget['texture'] | null },
    annotation: { value: false },
  };
  const stroke = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: glsl(strokeVertex),
    fragmentShader: glsl(strokeFragment),
    uniforms,
    blending: CustomBlending,
    blendEquation: MinEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  const combine = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: glsl(fusionVertex),
    fragmentShader: glsl(combineFragment),
    uniforms,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const corners = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];
  let geometry = new InstancedBufferGeometry();
  geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2));
  const quad = new BufferGeometry();
  quad.setAttribute('corner', new Float32BufferAttribute(corners, 2));
  quad.setDrawRange(0, 6);
  const mesh = new Mesh(geometry, stroke),
    screen = new Mesh(quad, combine);
  mesh.frustumCulled = screen.frustumCulled = false;
  const scene = new Scene(),
    camera = new Camera();
  scene.add(mesh);
  const fields = [0, 1, 2].map(
    () =>
      new WebGLRenderTarget(1, 1, {
        type: renderer.extensions.has('EXT_color_buffer_float') ? HalfFloatType : undefined,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      }),
  );
  let capacity = 0,
    active = 0;
  const clear = new Color();
  return {
    get texture() {
      return fields[active]!.texture;
    },
    get band() {
      return uniforms.band.value;
    },
    region,
    render(frame: InkFieldFrame, bounds: Vector4) {
      region.copy(bounds);
      world.set(bounds.z, bounds.w);
      const density = 1024 / Math.max(bounds.z, bounds.w);
      const w = Math.max(1, Math.ceil(bounds.z * density)),
        h = Math.max(1, Math.ceil(bounds.w * density));
      if (resolution.x !== w || resolution.y !== h) {
        resolution.set(w, h);
        fields.forEach((field) => field.setSize(w, h));
      }
      const pixel = Math.max(world.x / w, world.y / h);
      uniforms.band.value = Math.max(pixel * 8, frame.tension + pixel * 2);
      uniforms.tension.value = frame.tension;
      const count = Math.max(
        frame.marks.segments.length / 6,
        ...frame.segments.map((data) => data.length / 6),
      );
      if (count > capacity) {
        capacity = Math.max(count, capacity * 2);
        geometry.dispose();
        geometry = new InstancedBufferGeometry();
        geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2));
        mesh.geometry = geometry;
        geometry.setAttribute(
          'ends',
          new InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
        );
        geometry.setAttribute(
          'radii',
          new InstancedBufferAttribute(new Float32Array(capacity * 2), 2),
        );
        geometry.setAttribute(
          'detailVisibility',
          new InstancedBufferAttribute(new Float32Array(capacity), 1),
        );
      }
      const target = renderer.getRenderTarget(),
        autoClear = renderer.autoClear;
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      const viewport = renderer.getViewport(new Vector4()),
        scissor = renderer.getScissor(new Vector4());
      const scissorTest = renderer.getScissorTest();
      renderer.autoClear = false;
      renderer.setScissorTest(false);
      renderer.setClearColor(0xffffff, 1);
      active = 0;
      const upload = (data: Float32Array, opacity: Float32Array) => {
        const ends = geometry.getAttribute('ends'),
          radii = geometry.getAttribute('radii'),
          visibility = geometry.getAttribute('detailVisibility');
        for (let i = 0, at = 0; i < data.length; i += 6, at++) {
          ends.setXYZW(
            at,
            data[i]! - bounds.x,
            data[i + 1]! + bounds.y,
            data[i + 2]! - bounds.x,
            data[i + 3]! + bounds.y,
          );
          radii.setXY(at, data[i + 4]!, data[i + 5]!);
          visibility.setX(at, opacity[at]!);
        }
        for (const attribute of [ends, radii, visibility]) attribute.needsUpdate = true;
        geometry.instanceCount = data.length / 6;
        geometry.setDrawRange(0, 6);
        scene.clear();
        scene.add(mesh);
      };
      try {
        uniforms.annotation.value = false;
        renderer.setRenderTarget(fields[0]!);
        renderer.clear();
        frame.segments.forEach((data, source) => {
          upload(data, frame.visibility[source]!);
          renderer.setRenderTarget(fields[source ? 2 : active]!);
          renderer.clear();
          renderer.render(scene, camera);
          if (source) {
            const next = 1 - active;
            uniforms.first.value = fields[active]!.texture;
            uniforms.second.value = fields[2]!.texture;
            scene.clear();
            scene.add(screen);
            renderer.setRenderTarget(fields[next]!);
            renderer.render(scene, camera);
            active = next;
          }
        });
        if (frame.marks.segments.length) {
          uniforms.annotation.value = true;
          upload(frame.marks.segments, frame.marks.visibility);
          renderer.setRenderTarget(fields[active]!);
          renderer.render(scene, camera);
        }
      } finally {
        renderer.setRenderTarget(target);
        renderer.setViewport(viewport);
        renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest);
        renderer.setClearColor(clear, alpha);
        renderer.autoClear = autoClear;
      }
    },
    dispose() {
      fields.forEach((field) => field.dispose());
      geometry.dispose();
      quad.dispose();
      stroke.dispose();
      combine.dispose();
    },
  };
}
