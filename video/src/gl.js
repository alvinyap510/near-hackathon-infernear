// The 3D layer: InferNear's mark (two extruded brackets around the mint core), its rings and
// two particle streams, as on the landing page's hero. Unlike the landing page it keeps no clock:
// render(state) draws exactly the frame that state describes, so every frame can be re-rendered.
import {
  AdditiveBlending, AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight,
  ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PointLight,
  Points, Scene, ShaderMaterial, Shape, SRGBColorSpace, Sprite, SpriteMaterial, TorusGeometry, WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const NIGHT = 0x141519;
const SNOW = 0xf4f4f0;
const MINT = 0x00ec97;
const S = 1 / 6;

function bracketShape(mirror) {
  const X = x => ((mirror ? 32 - x : x) - 16) * S;
  const Y = y => (16 - y) * S;
  const s = new Shape();
  s.moveTo(X(4), Y(5.5));
  s.quadraticCurveTo(X(4), Y(4), X(5.5), Y(4));
  s.lineTo(X(12), Y(4)); s.lineTo(X(12), Y(8)); s.lineTo(X(8), Y(8)); s.lineTo(X(8), Y(24));
  s.lineTo(X(12), Y(24)); s.lineTo(X(12), Y(28)); s.lineTo(X(5.5), Y(28));
  s.quadraticCurveTo(X(4), Y(28), X(4), Y(26.5));
  s.closePath();
  return s;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, 'rgba(0,236,151,0.6)');
  r.addColorStop(0.3, 'rgba(0,236,151,0.18)');
  r.addColorStop(1, 'rgba(0,236,151,0)');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

const vertex = /* glsl */ `
  attribute float aSeed; attribute float aKind; attribute vec2 aOff;
  uniform float uTime; uniform vec3 uCore; uniform float uLeft; uniform float uRight; uniform float uSpread; uniform float uFade;
  varying float vAlpha; varying float vKind; varying float vMix;
  void main() {
    float speed = mix(0.07, 0.12, fract(aSeed * 7.13));
    float t = fract(uTime * speed + aSeed);
    vec3 p;
    if (aKind < 0.5) {
      float e = t * t * (3.0 - 2.0 * t); float spread = 1.0 - e;
      p.x = mix(uLeft, uCore.x, e);
      p.y = uCore.y + aOff.x * uSpread * spread + sin(t * 6.2831 + aSeed * 31.0) * 0.28 * spread;
      p.z = uCore.z + aOff.y * uSpread * 0.9 * spread;
      vAlpha = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.93, 1.0, t));
      vMix = smoothstep(0.6, 1.0, t);
    } else {
      float e = 1.0 - (1.0 - t) * (1.0 - t);
      p.x = mix(uCore.x, uRight, e);
      p.y = uCore.y + aOff.x * uSpread * 0.42 * e;
      p.z = uCore.z + aOff.y * uSpread * 0.35 * e;
      vAlpha = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.85, 1.0, t));
      vMix = 1.0;
    }
    vAlpha *= uFade;
    vKind = aKind;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (aKind < 0.5 ? mix(2.6, 1.6, vMix) : 3.8) * (14.0 / -mv.z);
  }
`;
const fragment = /* glsl */ `
  uniform vec3 uColA; uniform vec3 uColB;
  varying float vAlpha; varying float vKind; varying float vMix;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float a;
    if (vKind < 0.5) a = 1.0 - smoothstep(0.3, 0.5, length(c));
    else { vec2 q = abs(c); a = 1.0 - smoothstep(0.34, 0.46, max(q.x, q.y)); }
    float alpha = a * vAlpha * (vKind < 0.5 ? 0.75 : 0.95);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(mix(uColA, uColB, vMix), alpha);
  }
`;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGL(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(1920, 1080, false);
  renderer.setClearColor(NIGHT, 0);
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1920 / 1080, 0.05, 200);
  scene.add(new AmbientLight(SNOW, 1.15));
  const key = new DirectionalLight(SNOW, 2.4); key.position.set(-3, 4, 10); scene.add(key);
  const rim = new DirectionalLight(MINT, 0.6); rim.position.set(6, -3, -4); scene.add(rim);

  const rig = new Group(); scene.add(rig);
  const mark = new Group(); rig.add(mark);
  const depth = 0.9;
  const bracketMat = new MeshStandardMaterial({ color: SNOW, roughness: 0.42, metalness: 0.08 });
  const extrude = { depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035, bevelSegments: 3, curveSegments: 8 };
  const left = new Mesh(new ExtrudeGeometry(bracketShape(false), extrude), bracketMat);
  const right = new Mesh(new ExtrudeGeometry(bracketShape(true), extrude), bracketMat);
  left.geometry.translate(0, 0, -depth / 2); right.geometry.translate(0, 0, -depth / 2);
  mark.add(left, right);
  const core = new Mesh(new RoundedBoxGeometry(8 * S, 8 * S, 8 * S, 4, 0.12),
    new MeshStandardMaterial({ color: MINT, emissive: MINT, emissiveIntensity: 0.55, roughness: 0.32, metalness: 0 }));
  mark.add(core);
  const coreLight = new PointLight(MINT, 9, 7, 1.6); mark.add(coreLight);
  const glow = new Sprite(new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(5.5); mark.add(glow);
  const ring1 = new Mesh(new TorusGeometry(3.3, 0.014, 6, 200), new MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.25 }));
  const ring2 = new Mesh(new TorusGeometry(3.9, 0.009, 6, 200), new MeshBasicMaterial({ color: SNOW, transparent: true, opacity: 0.14 }));
  ring1.rotation.x = 1.25; ring2.rotation.x = 1.45; ring2.rotation.y = 0.5;
  mark.add(ring1, ring2);

  const R = rng(510);
  const nIn = 1300, nOut = 420, n = nIn + nOut;
  const seed = new Float32Array(n), kind = new Float32Array(n), off = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    seed[i] = R(); kind[i] = i < nIn ? 0 : 1;
    const a = R() * Math.PI * 2, r = Math.sqrt(R());
    off[i * 2] = Math.cos(a) * r; off[i * 2 + 1] = Math.sin(a) * r;
  }
  const pGeo = new BufferGeometry();
  pGeo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
  pGeo.setAttribute('aSeed', new BufferAttribute(seed, 1));
  pGeo.setAttribute('aKind', new BufferAttribute(kind, 1));
  pGeo.setAttribute('aOff', new BufferAttribute(off, 2));
  const uniforms = {
    uTime: { value: 0 }, uCore: { value: rig.position }, uLeft: { value: -14 }, uRight: { value: 14 },
    uSpread: { value: 2.2 }, uFade: { value: 1 }, uColA: { value: new Color(SNOW) }, uColB: { value: new Color(MINT) },
  };
  const points = new Points(pGeo, new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  points.frustumCulled = false;
  scene.add(points);

  /**
   * state: { time, assemble 0..1, core 0..1, x, y, scale, rotX, rotY, camZ, streams 0..1, rings 0..1, spread, bracketGap }
   */
  function render(s) {
    canvas.style.opacity = s.opacity ?? 1;
    const k = s.assemble ?? 1;
    const gap = s.bracketGap ?? 0;
    left.position.x = -2.6 * (1 - k) - gap; right.position.x = 2.6 * (1 - k) + gap;
    left.rotation.y = -1.1 * (1 - k); right.rotation.y = 1.1 * (1 - k);
    left.position.z = right.position.z = -3 * (1 - k);
    bracketMat.opacity = 1;
    const c = Math.max(0.001, s.core ?? 1);
    core.scale.setScalar(c * (1 + 0.04 * Math.sin(s.time * 2.4)));
    core.rotation.x = s.time * 0.35; core.rotation.y = s.time * 0.5;
    glow.material.opacity = Math.min(1, c) * (0.85 + 0.15 * Math.sin(s.time * 2.4)) * (s.glow ?? 1);
    glow.scale.setScalar(5.5 * (s.glowScale ?? 1));
    coreLight.intensity = 9 * Math.min(1, c);
    ring1.material.opacity = 0.25 * (s.rings ?? 1); ring2.material.opacity = 0.14 * (s.rings ?? 1);
    ring1.rotation.z = s.time * 0.12; ring2.rotation.z = -s.time * 0.08;
    rig.position.set(s.x ?? 0, s.y ?? 0, 0);
    rig.scale.setScalar(s.scale ?? 1);
    rig.rotation.set(s.rotX ?? 0, s.rotY ?? 0, 0);
    camera.position.set(s.camX ?? 0, s.camY ?? 0, s.camZ ?? 16);
    camera.lookAt(s.lookX ?? 0, s.lookY ?? 0, 0);
    uniforms.uTime.value = s.time;
    uniforms.uFade.value = s.streams ?? 1;
    uniforms.uSpread.value = s.spread ?? 2.2;
    uniforms.uLeft.value = s.left ?? -14; uniforms.uRight.value = s.right ?? 14;
    renderer.render(scene, camera);
  }
  return { render, clear: () => { renderer.clear(); canvas.style.opacity = 0; } };
}
