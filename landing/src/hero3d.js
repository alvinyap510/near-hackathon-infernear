// The hero scene: the logo's bracketed enclave in 3D. Yield streams in from "your chain" on the
// left, enters the mint core, and leaves to the right as credits. Loaded lazily as its own chunk;
// the page keeps a static SVG when this never runs (no WebGL, reduced motion, or an error).
import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Points,
  Scene,
  ShaderMaterial,
  Shape,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const NIGHT = 0x141519;
const SNOW = 0xf4f4f0;
const MINT = 0x00ec97;
const S = 1 / 6; // logo units (24 tall) to scene units (4 tall)

/** One bracket of the logo, from its SVG path, centred on the logo's 32-unit grid. */
function bracketShape(mirror) {
  const X = (x) => ((mirror ? 32 - x : x) - 16) * S;
  const Y = (y) => (16 - y) * S;
  const s = new Shape();
  s.moveTo(X(4), Y(5.5));
  s.quadraticCurveTo(X(4), Y(4), X(5.5), Y(4));
  s.lineTo(X(12), Y(4));
  s.lineTo(X(12), Y(8));
  s.lineTo(X(8), Y(8));
  s.lineTo(X(8), Y(24));
  s.lineTo(X(12), Y(24));
  s.lineTo(X(12), Y(28));
  s.lineTo(X(5.5), Y(28));
  s.quadraticCurveTo(X(4), Y(28), X(4), Y(26.5));
  s.closePath();
  return s;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(0,236,151,0.55)');
  r.addColorStop(0.35, 'rgba(0,236,151,0.16)');
  r.addColorStop(1, 'rgba(0,236,151,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const vertex = /* glsl */ `
  attribute float aSeed;
  attribute float aKind;
  attribute vec2 aOff;
  uniform float uTime;
  uniform vec3 uCore;
  uniform float uLeft;
  uniform float uRight;
  uniform float uSpread;
  uniform float uPx;
  varying float vAlpha;
  varying float vKind;
  varying float vMix;
  void main() {
    float speed = mix(0.07, 0.12, fract(aSeed * 7.13));
    float t = fract(uTime * speed + aSeed);
    vec3 p;
    if (aKind < 0.5) {
      float e = t * t * (3.0 - 2.0 * t);
      float spread = 1.0 - e;
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
    vKind = aKind;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aKind < 0.5 ? mix(2.4, 1.5, vMix) : 3.6;
    gl_PointSize = size * uPx * (14.0 / -mv.z);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  varying float vAlpha;
  varying float vKind;
  varying float vMix;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a;
    if (vKind < 0.5) {
      a = 1.0 - smoothstep(0.3, 0.5, length(c));
    } else {
      vec2 q = abs(c);
      a = 1.0 - smoothstep(0.34, 0.46, max(q.x, q.y));
    }
    float alpha = a * vAlpha * (vKind < 0.5 ? 0.75 : 0.95);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(mix(uColA, uColB, vMix), alpha);
  }
`;

export function mount(container, { onReady } = {}) {
  const small = matchMedia('(max-width: 720px)').matches || matchMedia('(pointer: coarse)').matches;
  const renderer = new WebGLRenderer({ antialias: !small, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.75));
  renderer.setClearColor(NIGHT, 1);
  renderer.outputColorSpace = SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 100);
  const DIST = 16;
  camera.position.set(0, 0, DIST);

  scene.add(new AmbientLight(SNOW, 1.15));
  const key = new DirectionalLight(SNOW, 2.3);
  key.position.set(-3, 4, 10);
  scene.add(key);
  const rim = new DirectionalLight(MINT, 0.5);
  rim.position.set(6, -3, -4);
  scene.add(rim);

  // The mark: two extruded brackets and the mint core.
  const mark = new Group();
  const rig = new Group(); // pointer and scroll rotate the rig; the intro moves the parts
  rig.add(mark);
  scene.add(rig);

  const depth = 0.9;
  const bracketMat = new MeshStandardMaterial({ color: SNOW, roughness: 0.42, metalness: 0.08 });
  const extrude = { depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035, bevelSegments: 3, curveSegments: 8 };
  const left = new Mesh(new ExtrudeGeometry(bracketShape(false), extrude), bracketMat);
  const right = new Mesh(new ExtrudeGeometry(bracketShape(true), extrude), bracketMat);
  left.geometry.translate(0, 0, -depth / 2);
  right.geometry.translate(0, 0, -depth / 2);
  mark.add(left, right);

  const core = new Mesh(
    new RoundedBoxGeometry(8 * S, 8 * S, 8 * S, 4, 0.12),
    new MeshStandardMaterial({ color: MINT, emissive: MINT, emissiveIntensity: 0.55, roughness: 0.32, metalness: 0 }),
  );
  mark.add(core);
  const coreLight = new PointLight(MINT, 9, 7, 1.6);
  mark.add(coreLight);
  const glow = new Sprite(new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(5.5);
  mark.add(glow);

  // Two faint orbit rings: the enclave's field.
  const ringMat = new MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.22 });
  const ring1 = new Mesh(new TorusGeometry(3.3, 0.012, 6, 160), ringMat);
  const ring2 = new Mesh(new TorusGeometry(3.9, 0.008, 6, 160), new MeshBasicMaterial({ color: SNOW, transparent: true, opacity: 0.12 }));
  ring1.rotation.x = 1.25;
  ring2.rotation.x = 1.45;
  ring2.rotation.y = 0.5;
  mark.add(ring1, ring2);

  // Particles: yield in (round, snow to mint), credits out (mint squares).
  const nIn = small ? 360 : 1100;
  const nOut = small ? 140 : 380;
  const n = nIn + nOut;
  const seed = new Float32Array(n);
  const kind = new Float32Array(n);
  const off = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    seed[i] = Math.random();
    kind[i] = i < nIn ? 0 : 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    off[i * 2] = Math.cos(a) * r;
    off[i * 2 + 1] = Math.sin(a) * r;
  }
  const pGeo = new BufferGeometry();
  pGeo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
  pGeo.setAttribute('aSeed', new BufferAttribute(seed, 1));
  pGeo.setAttribute('aKind', new BufferAttribute(kind, 1));
  pGeo.setAttribute('aOff', new BufferAttribute(off, 2));
  const uniforms = {
    uTime: { value: 0 },
    uCore: { value: rig.position },
    uLeft: { value: -12 },
    uRight: { value: 12 },
    uSpread: { value: 2.2 },
    uPx: { value: renderer.getPixelRatio() },
    uColA: { value: new Color(SNOW) },
    uColB: { value: new Color(MINT) },
  };
  const points = new Points(
    pGeo,
    new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending }),
  );
  points.frustumCulled = false;
  scene.add(points);

  // Layout: the mark sits right of centre on wide screens, top-centre on phones.
  let scale = 1;
  const layout = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visH = 2 * DIST * Math.tan((camera.fov * Math.PI) / 360);
    const visW = visH * camera.aspect;
    const narrow = camera.aspect < 0.9;
    scale = Math.min((narrow ? 0.2 : 0.27) * visH, (narrow ? 0.5 : 0.2) * visW) / 4;
    rig.scale.setScalar(scale);
    // Screen position matches the CSS stream labels: 34% from the top (30% on phones).
    rig.position.set(narrow ? 0 : visW * 0.29, narrow ? visH * 0.2 : visH * 0.16, 0);
    uniforms.uLeft.value = -visW / 2 - 1.5;
    uniforms.uRight.value = visW / 2 + 1.5;
    uniforms.uSpread.value = Math.max(1.0, scale * 2.0);
  };
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(container);

  // Pointer tilts the rig; scroll turns it and pulls the camera in.
  const target = { x: 0, y: 0 };
  const onPointer = (e) => {
    target.x = (e.clientX / innerWidth) * 2 - 1;
    target.y = (e.clientY / innerHeight) * 2 - 1;
  };
  addEventListener('pointermove', onPointer, { passive: true });
  let scrollP = 0;

  let running = true;
  let raf = 0;
  let last = performance.now();
  let t = 0;
  const t0 = performance.now();
  const ease = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;
    const born = (now - t0) / 1000; // wall time, so a slow first second still finishes the intro
    uniforms.uTime.value = t;

    // Intro: brackets close in, the core lands.
    const k = ease(born / 1.6);
    left.position.x = -2.4 * (1 - k);
    right.position.x = 2.4 * (1 - k);
    left.rotation.y = -0.9 * (1 - k);
    right.rotation.y = 0.9 * (1 - k);
    const c = ease((born - 0.5) / 1.1);
    core.scale.setScalar(Math.max(0.001, c * (1 + 0.05 * Math.sin(t * 2.4))));
    core.rotation.x = t * 0.35;
    core.rotation.y = t * 0.5;
    glow.material.opacity = c * (0.85 + 0.15 * Math.sin(t * 2.4));
    coreLight.intensity = 9 * c;
    ring1.rotation.z = t * 0.12;
    ring2.rotation.z = -t * 0.08;

    rig.rotation.y += (target.x * 0.45 + scrollP * 0.9 - 0.25 - rig.rotation.y) * 0.06;
    rig.rotation.x += (target.y * 0.25 + scrollP * 0.25 - rig.rotation.x) * 0.06;
    camera.position.z += (DIST - scrollP * 4.5 - camera.position.z) * 0.08;
    renderer.render(scene, camera);
  };
  const start = () => {
    if (!running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  raf = requestAnimationFrame(frame);
  const io = new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? start() : stop()));
  io.observe(container);
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVis);

  requestAnimationFrame(() => onReady?.());

  return {
    setScroll(p) {
      scrollP = p;
    },
    destroy() {
      stop();
      io.disconnect();
      ro.disconnect();
      removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVis);
      renderer.dispose();
      canvas.remove();
    },
  };
}
