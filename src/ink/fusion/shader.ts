export const strokeVertex = `#version 300 es
in vec2 corner;
in vec4 ends;
in vec2 radii;
in float detailVisibility;
uniform vec2 resolution;
uniform vec2 world;
uniform float band;
out vec2 point;
flat out vec4 segment;
flat out vec2 radius;
flat out float visibility;
void main() {
  float pixel = max(world.x / resolution.x, world.y / resolution.y);
  float padding = max(radii.x, radii.y) + band;
  point = mix(min(ends.xy, ends.zw) - padding, max(ends.xy, ends.zw) + padding, corner);
  segment = ends;
  radius = radii;
  visibility = detailVisibility;
  vec2 clip = point / (resolution * pixel * .5);
  gl_Position = vec4(clip.x, -clip.y, 0., 1.);
  if (detailVisibility <= 0.) gl_Position = vec4(2., 2., 0., 1.);
}
`;
export const strokeFragment = `#version 300 es
precision highp float;
in vec2 point;
flat in vec4 segment;
flat in vec2 radius;
flat in float visibility;
uniform float band;
uniform vec2 world;
uniform vec2 resolution;
out vec4 color;
void main() {
  vec2 a = segment.xy, b = segment.zw, ab = b-a;
  float t = clamp(dot(point-a, ab) / max(dot(ab, ab), .00001), 0., 1.);
  float d = length(point - mix(a,b,t)) - mix(radius.x, radius.y, t);
  float pixel = max(world.x / resolution.x, world.y / resolution.y);
  float coverage = (1. - smoothstep(-pixel*.7, pixel*.7, d)) * visibility;
  // Both channels use MIN blending: distance union and one minus ink coverage.
  color = vec4(clamp(.5 + d / (2.*band), 0., 1.), 1.-coverage, 0., 1.);
}
`;
export const fusionVertex = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() { uv=corner; gl_Position=vec4(corner*2.-1.,0.,1.); }
`;
export const fusionFragment = `#version 300 es
precision highp float;
in vec2 uv;
uniform vec2 resolution;
uniform vec2 world;
uniform vec3 ink;
uniform float tension;
uniform float band;
uniform bool details;
uniform sampler2D first;
uniform sampler2D second;
out vec4 color;
void main() {
  vec2 firstField=texture(first,uv).rg, secondField=texture(second,uv).rg;
  float a=(firstField.r-.5)*2.*band, b=(secondField.r-.5)*2.*band;
  float h=max(tension-abs(a-b),0.)/max(tension,.00001);
  float distance=min(a,b)-h*h*tension*.25;
  float pixel=max(world.x/resolution.x,world.y/resolution.y);
  float fused=1.-smoothstep(-pixel*.7,pixel*.7,distance);
  float base=max(1.-smoothstep(-pixel*.7,pixel*.7,a), 1.-smoothstep(-pixel*.7,pixel*.7,b));
  float coverage=max(1.-firstField.g,1.-secondField.g);
  // Keep the contact bridge while fading each whole stroke at its original width.
  color=vec4(ink, details ? min(1.,coverage+max(0.,fused-base)) : fused);
}
`;
