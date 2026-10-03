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
  float target = primitive(SOURCE_COUNT, p);
  for (int i = SOURCE_COUNT + 1; i < SHAPE_COUNT; i++) target = min(target, primitive(i, p));
  if (morph >= 1.) return target;
  float d = primitive(0, p);
  for (int i = 1; i < SOURCE_COUNT; i++) {
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
// Return the normal of the actual visible surface, including zero coverage for a miss.
// The caller compares subpixel hits instead of probing inside the blended volume.
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
  vec3 n = normalAt(point, pixel * .5);
  vec4 clip = clipMatrix * vec4(point,1.);
  depth = clip.z / clip.w * .5 + .5;
  return vec4(n,1.);
}
vec3 shade(vec3 n, float edge) {
  float crease = smoothstep(.2,1.4,edge);
  float stroke = .5 * crease;
  vec3 w = abs(n);
  float wash = dot(w,vec3(n.x > 0. ? .88 : 1.,n.y > 0. ? .82 : 1.,n.z > 0. ? .93 : .85)) / max(w.x+w.y+w.z,.00001);
  return mix(mix(paper,pigment,.65*wash),ink,stroke);
}
void main() {
  vec3 direction = normalize(rayExit-rayOrigin);
  vec3 dx = dFdx(direction), dy = dFdy(direction);
  vec4 color = vec4(0.);
  float depth = 1.;
  vec4 surfaces[8];
  for(int i=0;i<8;i++) {
    vec2 offset = i==0 ? vec2(-.5,-.5) : i==1 ? vec2(.5,-.5) :
                  i==2 ? vec2(.5,.5) : i==3 ? vec2(-.5,.5) :
                  i==4 ? vec2(-.125,-.375) : i==5 ? vec2(.375,-.125) :
                  i==6 ? vec2(.125,.375) : vec2(-.375,.125);
    float sampleDepth;
    vec3 sampleDirection = normalize(direction+dx*offset.x+dy*offset.y);
    surfaces[i] = trace(sampleDirection,dx,dy,sampleDepth);
    depth = min(depth,sampleDepth);
  }
  // Corner samples cover the full pixel footprint so a thin edge cannot fall
  // between sample footprints. Only visible hits define a crease: no derivative
  // quad steps, internal field branches or dark halos at grazing concave joins.
  float edge = 0.;
  for(int i=0;i<4;i++) {
    int next = (i+1)%4;
    edge = max(edge, length(surfaces[i].xyz-surfaces[next].xyz)*surfaces[i].a*surfaces[next].a);
  }
  // Interior rotated samples carry the fill; corner samples retain a continuous
  // thin crease and contribute a small amount to antialiasing the silhouette.
  for(int i=0;i<8;i++) color += vec4(shade(surfaces[i].xyz,edge)*surfaces[i].a,surfaces[i].a) * (i<4 ? .05 : .2);
  if(color.a == 0.) discard;
  vec3 wash = mix(color.rgb/color.a,ink,.5*(1.-color.a));
  gl_FragColor = vec4(wash,color.a);
  gl_FragDepth = depth;
  #include <colorspace_fragment>
}
`;
