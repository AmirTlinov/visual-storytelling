export const strokeVertex = `#version 300 es
in vec2 corner;
in vec4 ends;
in vec2 radii;
uniform vec2 resolution;
uniform vec2 world;
uniform float band;
out vec2 point;
flat out vec4 segment;
flat out vec2 radius;
void main() {
  float pixel = max(world.x / resolution.x, world.y / resolution.y);
  float padding = max(radii.x, radii.y) + band;
  point = mix(min(ends.xy, ends.zw) - padding, max(ends.xy, ends.zw) + padding, corner);
  segment = ends;
  radius = radii;
  vec2 clip = point / (resolution * pixel * .5);
  gl_Position = vec4(clip.x, -clip.y, 0., 1.);
}
`;
export const strokeFragment = `#version 300 es
precision highp float;
in vec2 point;
flat in vec4 segment;
flat in vec2 radius;
uniform float band;
out vec4 color;
void main() {
  vec2 a = segment.xy, b = segment.zw, ab = b-a;
  float t = clamp(dot(point-a, ab) / max(dot(ab, ab), .00001), 0., 1.);
  float d = length(point - mix(a,b,t)) - mix(radius.x, radius.y, t);
  color = vec4(vec3(clamp(.5 + d / (2.*band), 0., 1.)), 1.);
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
uniform sampler2D first;
uniform sampler2D second;
out vec4 color;
void main() {
  float a=(texture(first,uv).r-.5)*2.*band, b=(texture(second,uv).r-.5)*2.*band;
  float h=max(tension-abs(a-b),0.)/max(tension,.00001);
  float distance=min(a,b)-h*h*tension*.25;
  float pixel=max(world.x/resolution.x,world.y/resolution.y);
  color=vec4(ink,1.-smoothstep(-pixel*.7,pixel*.7,distance));
}
`;
