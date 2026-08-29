/** The marbled liquid — shared by the portal's eye, the pond and the river. */
export const SWIRL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float sw = a + 2.6 * r - uTime * 0.32;
    float n1 = sin(sw * 3.0 + sin(r * 7.0 - uTime * 0.6) * 1.5);
    float n2 = sin(sw * 5.0 - r * 4.0 + uTime * 0.45);
    vec3 deep = vec3(0.13, 0.20, 0.42);
    vec3 violet = vec3(0.42, 0.33, 0.85);
    vec3 rose = vec3(0.94, 0.45, 0.62);
    vec3 mint = vec3(0.45, 0.78, 0.62);
    vec3 col = mix(deep, violet, smoothstep(-1.0, 1.0, n1));
    col = mix(col, rose, smoothstep(0.55, 1.0, n2) * 0.55);
    col = mix(col, mint, smoothstep(0.7, 1.0, sin(sw * 2.0 + r * 6.0 + uTime * 0.2)) * 0.3);
    col *= 0.85 + 0.15 * sin(r * 12.0 - uTime * 0.8);
    float alpha = smoothstep(1.0, 0.94, r) * 0.94;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Painterly post pass: Kuwahara oil-paint smoothing + muted grade + canvas paper. */
