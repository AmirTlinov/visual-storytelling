/** The same primitive distances and compact contact blend as the CPU field reference. */
export const fieldShader = /* glsl */ `
uniform int kinds[SHAPE_COUNT];
uniform vec4 parameters[SHAPE_COUNT];
uniform mat4 transforms[SHAPE_COUNT];
uniform float scales[SHAPE_COUNT];
uniform float morph;
uniform float tension;
uniform vec4 planes[6];
uniform int planeCount;
float primitive(int i, vec3 point) {
  vec3 p = (transforms[i] * vec4(point, 1.)).xyz;
  vec4 a = parameters[i];
  if (kinds[i] == 0) {
    vec3 q = abs(p) - a.xyz;
    return (length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - a.w) * scales[i];
  }
  if (kinds[i] == 2) p.x -= clamp(p.x, -a.y, a.y);
  return (length(p) - a.x) * scales[i];
}
float field(vec3 p) {
  if (morph >= 1.) return primitive(SHAPE_COUNT - 1, p);
  float target = primitive(SHAPE_COUNT - 1, p);
  float d = primitive(0, p);
  for (int i = 1; i < SHAPE_COUNT - 1; i++) {
    float next = primitive(i, p);
    float h = tension > 0. ? max(0., tension - abs(d - next)) / tension : 0.;
    d = min(d, next) - h * h * tension * .25;
  }
  for (int i=0;i<6;i++) {
    if(i >= planeCount) break;
    d = max(d,dot(planes[i].xyz,p)+planes[i].w);
  }
  return morph <= 0. ? d : mix(d, target, morph);
}
`;

export const vertexShader = /* glsl */ `
varying vec3 rayExit;
void main() {
  rayExit = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}
`;

export const fragmentShader = /* glsl */ `
${fieldShader}
uniform vec3 rayOrigin;
uniform vec3 boundsMin;
uniform vec3 boundsMax;
uniform mat4 clipMatrix;
uniform vec3 paper;
uniform vec3 pigment;
uniform vec3 ink;
varying vec3 rayExit;
vec3 normalAt(vec3 p, float e) {
  return normalize(vec3(field(p+vec3(e,0,0))-field(p-vec3(e,0,0)),
    field(p+vec3(0,e,0))-field(p-vec3(0,e,0)), field(p+vec3(0,0,e))-field(p-vec3(0,0,e))));
}
// A small fixed pixel footprint makes creases and silhouettes stable during motion.
// Each sample traces the same field; no temporal history or changing topology is involved.
vec4 trace(vec3 direction, vec3 dx, vec3 dy, out float depth) {
  depth = 1.;
  float pixelAngle = max(length(dx),length(dy));
  vec3 safeDirection = mix(direction, vec3(1e-8), lessThan(abs(direction),vec3(1e-8)));
  vec3 nearBox = (boundsMin - rayOrigin) / safeDirection;
  vec3 farBox = (boundsMax - rayOrigin) / safeDirection;
  vec3 low = min(nearBox,farBox), high = max(nearBox,farBox);
  float t = max(0., max(low.x, max(low.y,low.z)));
  float end = min(high.x,min(high.y,high.z));
  bool hit = false;
  for(int i=0;i<192;i++) {
    if(t > end) break;
    float pixel = max(.00001, pixelAngle * t);
    float d = abs(field(rayOrigin + direction * t));
    if(d <= pixel * .04) { hit = true; break; }
    t += max(d * .85, pixel * .02);
  }
  if(!hit) return vec4(0.);
  vec3 point = rayOrigin + direction * t;
  float pixel = max(.00001,pixelAngle*t);
  vec3 n = normalAt(point, pixel * .2);
  // Compare along the visible tangent plane: sampling inside the volume would
  // mistake the union's internal distance branches for visible creases.
  vec3 tangentX = (dx-n*dot(n,dx))*t;
  vec3 tangentY = (dy-n*dot(n,dy))*t;
  float edge = max(length(normalAt(point+tangentX,pixel*.7)-normalAt(point-tangentX,pixel*.7)),
                   length(normalAt(point+tangentY,pixel*.7)-normalAt(point-tangentY,pixel*.7)));
  float crease = smoothstep(.12,.9,edge);
  float facing = dot(n,direction);
  float silhouette = 1. - smoothstep(0.,1.,facing*facing/max(edge,.00001));
  float stroke = .5 * max(crease,silhouette);
  vec3 w = abs(n);
  float wash = dot(w,vec3(n.x > 0. ? .88 : 1.,n.y > 0. ? .82 : 1.,n.z > 0. ? .93 : .85)) / (w.x+w.y+w.z);
  vec3 color = mix(mix(paper,pigment,.65*wash),ink,stroke);
  vec4 clip = clipMatrix * vec4(point,1.);
  depth = clip.z / clip.w * .5 + .5;
  return vec4(color,1.);
}
void main() {
  vec3 direction = normalize(rayExit-rayOrigin);
  vec3 dx = dFdx(direction), dy = dFdy(direction);
  vec4 color = vec4(0.);
  float depth = 1.;
  for(int i=0;i<4;i++) {
    vec2 offset = i==0 ? vec2(-.125,-.375) : i==1 ? vec2(.375,-.125) :
                  i==2 ? vec2(.125,.375) : vec2(-.375,.125);
    float sampleDepth;
    color += trace(normalize(direction+dx*offset.x+dy*offset.y),dx,dy,sampleDepth);
    depth = min(depth,sampleDepth);
  }
  if(color.a == 0.) discard;
  vec3 wash = mix(color.rgb/color.a,ink,.5*(1.-color.a*.25));
  gl_FragColor = vec4(wash,color.a*.25);
  gl_FragDepth = depth;
  #include <colorspace_fragment>
}
`;
