export const fusionVertex = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0., 1.); }
`;
export const fusionFragment = `
precision highp float;
uniform vec2 resolution;
uniform vec2 world;
uniform vec3 ink;
uniform float tension;
uniform float morph;
uniform float level;
uniform float relaxation;
uniform sampler2D first;
uniform sampler2D second;
uniform sampler2D target;
uniform sampler2D relaxedFirst;
uniform sampler2D relaxedTarget;
uniform vec2 sizes[3];
uniform vec4 poses[3];

float field(sampler2D image, vec2 size, vec4 pose, vec2 p) {
  p = (p - pose.xy) / pose.z;
  float c = cos(pose.w), s = sin(pose.w);
  p = mat2(c, -s, s, c) * p;
  vec2 uv = p / size + .5;
  vec2 packedDistance = texture2D(image, clamp(uv, 0., 1.)).rg;
  float d = (dot(packedDistance, vec2(65280., 255.)) / 65535. - .5) * 512.;
  return (d + length(max(abs(p) - size * .5, 0.))) * pose.z;
}
float join(float a, float b) {
  if (tension <= 0.) return min(a,b);
  float h = max(tension - abs(a-b), 0.) / tension;
  return min(a,b) - h*h*tension*.25;
}
void main() {
  float pixel = max(world.x / resolution.x, world.y / resolution.y);
  vec2 p = (gl_FragCoord.xy - resolution * .5) * pixel;
  p.y = -p.y;
  float a = field(first, sizes[0], poses[0], p);
  float b = field(second, sizes[1], poses[1], p);
  float c = field(target, sizes[2], poses[2], p);
  float distance = mix(join(a,b), c, morph);
  if (relaxation > 0.) {
    vec2 uv = p / world + .5;
    vec2 ra = texture2D(relaxedFirst, uv).rg, rb = texture2D(relaxedTarget, uv).rg;
    float da = (dot(ra, vec2(65280.,255.)) / 65535. - .5) * 512.;
    float db = (dot(rb, vec2(65280.,255.)) / 65535. - .5) * 512.;
    distance = mix(distance, mix(da,db,morph), relaxation);
  }
  distance -= level;
  float alpha = 1. - smoothstep(-pixel*.7, pixel*.7, distance);
  gl_FragColor = vec4(ink, alpha);
}
`;
