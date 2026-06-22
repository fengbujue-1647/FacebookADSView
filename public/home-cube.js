import * as THREE from "/vendor/three.module.js";

const mount = document.querySelector("[data-home-cube]");
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

const MAX_PIXEL_RATIO = 1.25;
const FRAME_INTERVAL_MS = 1000 / 45;
const GLOBAL_ROTATION_SPEED = 0.105;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isNarrowViewport = window.matchMedia?.("(max-width: 759px)")?.matches ?? window.innerWidth < 760;
const supportsPointerFollow = window.matchMedia?.("(pointer: fine)")?.matches && !isIOS && !isNarrowViewport;

if (mount && !reduceMotion) {
  mount.dataset.cubeRenderer = "gpu-instanced";
  mount.dataset.cubePointer = supportsPointerFollow ? "enabled" : "disabled";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: "default"
  });

  mount.dataset.cubePlatform = isIOS ? "ios-stable" : "default";
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isIOS ? 1 : MAX_PIXEL_RATIO));
  renderer.setClearColor(0xffffff, 0);
  mount.appendChild(renderer.domElement);

  const group = new THREE.Group();
  scene.add(group);

  const blockSide = 6;
  const cubeCount = blockSide ** 3;
  const unitSize = 0.19;
  const targetSpacing = 0.24;
  const blockExtent = (blockSide - 1) * targetSpacing + unitSize * 1.35;
  const targetOffset = (blockSide - 1) / 2;

  const scatterArray = new Float32Array(cubeCount * 3);
  const targetArray = new Float32Array(cubeCount * 3);
  const seedArray = new Float32Array(cubeCount);
  const scaleArray = new Float32Array(cubeCount);
  const colorArray = new Float32Array(cubeCount * 3);

  const color = new THREE.Color();
  const colorA = new THREE.Color(0xffffff);
  const colorB = new THREE.Color(0xdde8ff);

  for (let index = 0; index < cubeCount; index += 1) {
    const x = index % blockSide;
    const y = Math.floor(index / blockSide) % blockSide;
    const z = Math.floor(index / (blockSide * blockSide));
    const offset = index * 3;
    const angle = index * 0.56;
    const radius = 1.25 + (index % 17) * 0.055;
    const band = (index / cubeCount - 0.5) * 2.4;

    targetArray[offset] = (x - targetOffset) * targetSpacing;
    targetArray[offset + 1] = (y - targetOffset) * targetSpacing;
    targetArray[offset + 2] = (z - targetOffset) * targetSpacing;

    scatterArray[offset] = Math.cos(angle) * radius + band;
    scatterArray[offset + 1] = Math.sin(index * 0.37) * 1.36 + ((index % 11) - 5) * 0.055;
    scatterArray[offset + 2] = Math.sin(angle) * radius * 0.72 + Math.cos(index * 0.19) * 0.82;

    seedArray[index] = index;
    scaleArray[index] = 0.68 + (index % 7) * 0.028;

    color.copy(colorA).lerp(colorB, (x + y + z) / ((blockSide - 1) * 3));
    colorArray[offset] = color.r;
    colorArray[offset + 1] = color.g;
    colorArray[offset + 2] = color.b;
  }

  function addInstanceAttributes(geometry) {
    geometry.instanceCount = cubeCount;
    geometry.setAttribute("aScatter", new THREE.InstancedBufferAttribute(scatterArray, 3));
    geometry.setAttribute("aTarget", new THREE.InstancedBufferAttribute(targetArray, 3));
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seedArray, 1));
    geometry.setAttribute("aScale", new THREE.InstancedBufferAttribute(scaleArray, 1));
    geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(colorArray, 3));
    return geometry;
  }

  function createInstancedGeometry(baseGeometry, attributeNames) {
    const geometry = new THREE.InstancedBufferGeometry();
    if (baseGeometry.index) {
      geometry.setIndex(baseGeometry.index);
    }
    attributeNames.forEach((name) => {
      const attribute = baseGeometry.getAttribute(name);
      if (attribute) {
        geometry.setAttribute(name, attribute);
      }
    });
    return addInstanceAttributes(geometry);
  }

  const transformShader = `
attribute vec3 aScatter;
attribute vec3 aTarget;
attribute float aSeed;
attribute float aScale;
attribute vec3 aColor;

uniform float uTime;
uniform float uProgress;

varying vec3 vColor;
varying float vPresence;

mat3 rotateX(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(
    1.0, 0.0, 0.0,
    0.0, c, -s,
    0.0, s, c
  );
}

mat3 rotateY(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(
    c, 0.0, s,
    0.0, 1.0, 0.0,
    -s, 0.0, c
  );
}

mat3 rotateZ(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(
    c, -s, 0.0,
    s, c, 0.0,
    0.0, 0.0, 1.0
  );
}

mat3 instanceRotation(float seed, float scatterWeight) {
  float rotationSeed = seed * 0.131;
  vec3 angles = vec3(
    rotationSeed + uTime * 0.34,
    rotationSeed * 1.7 + uTime * 0.28,
    rotationSeed * 0.7 + uTime * 0.22
  );
  angles *= scatterWeight;
  return rotateZ(angles.z) * rotateY(angles.y) * rotateX(angles.x);
}

vec3 instanceOrigin(float seed, float scatterWeight) {
  vec3 drift = vec3(
    sin(uTime * 0.46 + seed * 0.17) * scatterWeight * 0.18,
    cos(uTime * 0.38 + seed * 0.11) * scatterWeight * 0.12,
    sin(uTime * 0.30 + seed * 0.13) * scatterWeight * 0.14
  );
  return mix(aScatter, aTarget, uProgress) + drift;
}

vec3 transformInstancePosition(vec3 localPosition) {
  float scatterWeight = smoothstep(1.0, 0.34, uProgress);
  mat3 rotation = instanceRotation(aSeed, scatterWeight);
  vec3 origin = instanceOrigin(aSeed, scatterWeight);
  float finalScale = mix(aScale, 1.0, smoothstep(0.18, 1.0, uProgress));
  return origin + rotation * (localPosition * finalScale);
}
`;

  const cubeVertexShader = `
${transformShader}

varying vec3 vNormal;

void main() {
  float scatterWeight = smoothstep(1.0, 0.34, uProgress);
  mat3 rotation = instanceRotation(aSeed, scatterWeight);
  vec3 transformed = transformInstancePosition(position);

  vNormal = normalize(normalMatrix * rotation * normal);
  vColor = aColor;
  vPresence = clamp((uProgress - 0.14) / 0.86, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

  const cubeFragmentShader = `
precision highp float;

uniform float uOpacity;

varying vec3 vColor;
varying vec3 vNormal;
varying float vPresence;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 light = normalize(vec3(0.42, 0.62, 0.74));
  float shade = dot(normal, light) * 0.5 + 0.5;
  float rim = pow(1.0 - abs(normal.z), 2.0);
  vec3 color = mix(vColor * 0.94, vec3(1.0), shade * 0.32);
  color = mix(color, vec3(0.83, 0.90, 1.0), rim * 0.18);
  color = mix(color, vec3(0.96, 0.98, 1.0), vPresence * 0.08);
  gl_FragColor = vec4(color, uOpacity);
}
`;

  const lineVertexShader = `
${transformShader}

void main() {
  vec3 transformed = transformInstancePosition(position);
  vColor = aColor;
  vPresence = clamp((uProgress - 0.14) / 0.86, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

  const lineFragmentShader = `
precision highp float;

uniform float uOpacity;

varying vec3 vColor;
varying float vPresence;

void main() {
  vec3 blue = vec3(0.0, 0.321, 0.851);
  vec3 color = mix(blue, vColor, 0.08 + vPresence * 0.04);
  gl_FragColor = vec4(color, uOpacity);
}
`;

  const timeUniform = { value: 0 };
  const progressUniform = { value: 0 };
  const cubeOpacityUniform = { value: 0.38 };
  const edgeOpacityUniform = { value: 0.12 };

  const boxGeometry = new THREE.BoxGeometry(unitSize, unitSize, unitSize);
  const cubeGeometry = createInstancedGeometry(boxGeometry, ["position", "normal"]);
  const cubeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uProgress: progressUniform,
      uOpacity: cubeOpacityUniform
    },
    vertexShader: cubeVertexShader,
    fragmentShader: cubeFragmentShader,
    transparent: true,
    depthWrite: false
  });
  const cubeMesh = new THREE.Mesh(cubeGeometry, cubeMaterial);
  cubeMesh.frustumCulled = false;
  group.add(cubeMesh);

  const edgeSourceGeometry = new THREE.EdgesGeometry(boxGeometry);
  const edgeGeometry = createInstancedGeometry(edgeSourceGeometry, ["position"]);
  const edgeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uProgress: progressUniform,
      uOpacity: edgeOpacityUniform
    },
    vertexShader: lineVertexShader,
    fragmentShader: lineFragmentShader,
    transparent: true,
    depthWrite: false
  });
  const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edgeLines.frustumCulled = false;
  group.add(edgeLines);

  const shellGeometry = new THREE.BoxGeometry(blockExtent, blockExtent, blockExtent);
  const shellMaterial = new THREE.MeshBasicMaterial({
    color: 0xf8fbff,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const shellMesh = new THREE.Mesh(shellGeometry, shellMaterial);
  group.add(shellMesh);

  const shellEdgeGeometry = new THREE.EdgesGeometry(shellGeometry);
  const shellEdgeMaterial = new THREE.LineBasicMaterial({
    color: 0x0052d9,
    transparent: true,
    opacity: 0
  });
  const shellEdges = new THREE.LineSegments(shellEdgeGeometry, shellEdgeMaterial);
  group.add(shellEdges);

  let width = 1;
  let height = 1;
  let lockedIOSHeight = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerTargetX = 0;
  let pointerTargetY = 0;
  let scrollProgress = 0;
  let smoothProgress = 0;
  let frameId = 0;
  let scrollFrameId = 0;
  let startedAtMs = 0;
  let lastFrameTime = 0;
  let isRunning = false;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function easeInOut(value) {
    return value < 0.5
      ? 2 * value * value
      : 1 - Math.pow(-2 * value + 2, 2) / 2;
  }

  function resize() {
    const rect = mount.getBoundingClientRect();
    const nextWidth = Math.max(1, rect.width);
    if (isIOS && lockedIOSHeight && Math.abs(nextWidth - width) < 2) {
      return;
    }
    if (isIOS && Math.abs(nextWidth - width) >= 2) {
      lockedIOSHeight = 0;
      mount.style.height = "";
    }
    width = nextWidth;
    height = Math.max(1, isIOS ? (lockedIOSHeight || rect.height) : rect.height);
    if (isIOS) {
      lockedIOSHeight = height;
      mount.style.height = `${height}px`;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.set(width < 760 ? 0 : 0.2, width < 760 ? 0.45 : 0.2, width < 760 ? 8.4 : 7.2);
    camera.updateProjectionMatrix();
  }

  function updateScrollProgress() {
    const target = document.querySelector("[data-cube-target]");
    if (!target) {
      scrollProgress = clamp(window.scrollY / Math.max(1, window.innerHeight), 0, 1);
      mount.dataset.cubeProgress = scrollProgress.toFixed(3);
      return;
    }
    const rect = target.getBoundingClientRect();
    const viewport = window.innerHeight || 1;
    const start = viewport * 0.88;
    const end = viewport * 0.28;
    const raw = (start - rect.top) / Math.max(1, start - end);
    scrollProgress = clamp(raw, 0, 1);
    mount.dataset.cubeProgress = scrollProgress.toFixed(3);
  }

  function scheduleScrollProgressUpdate() {
    if (scrollFrameId) return;
    scrollFrameId = window.requestAnimationFrame(() => {
      scrollFrameId = 0;
      updateScrollProgress();
    });
  }

  function animate(timeMs) {
    if (!isRunning) return;

    if (lastFrameTime && timeMs - lastFrameTime < FRAME_INTERVAL_MS) {
      frameId = window.requestAnimationFrame(animate);
      return;
    }

    if (!startedAtMs) {
      startedAtMs = timeMs;
    }
    lastFrameTime = timeMs;
    const time = timeMs * 0.001;
    const elapsedTime = (timeMs - startedAtMs) * 0.001;
    const delta = scrollProgress - smoothProgress;
    smoothProgress += delta * Math.min(0.12, 0.055 + Math.abs(delta) * 0.09);
    const t = easeInOut(smoothProgress);
    const blockPresence = clamp((t - 0.14) / 0.86, 0, 1);
    pointerX += (pointerTargetX - pointerX) * 0.08;
    pointerY += (pointerTargetY - pointerY) * 0.08;

    timeUniform.value = time;
    progressUniform.value = t;
    cubeOpacityUniform.value = 0.33 + blockPresence * 0.12;
    edgeOpacityUniform.value = 0.12 * (1 - blockPresence) + 0.045 * blockPresence;
    shellMaterial.opacity = blockPresence * 0.045;
    shellEdgeMaterial.opacity = blockPresence * 0.14;

    const assembledWeight = smoothProgress;
    const globalTurn = elapsedTime * GLOBAL_ROTATION_SPEED;
    const pointerWeight = width < 760 ? 0 : 1;
    group.rotation.y = -0.24 + pointerX * 0.13 * pointerWeight + globalTurn * (0.35 + assembledWeight * 0.65);
    group.rotation.x = -0.08 + pointerY * 0.09 * pointerWeight + t * 0.05 + Math.sin(globalTurn * 0.7) * 0.035;
    group.rotation.z = Math.sin(globalTurn * 0.52) * 0.018 * assembledWeight - pointerX * 0.018 * pointerWeight;
    group.position.x = width < 760 ? 0.02 : 2.18 - t * 0.58 + pointerX * 0.08;
    group.position.y = width < 760 ? -0.58 + t * 0.42 : -0.18 + t * 0.06 - pointerY * 0.045;
    group.scale.setScalar(width < 760 ? 0.82 : 0.96);

    renderer.render(scene, camera);
    frameId = window.requestAnimationFrame(animate);
  }

  function startRenderLoop() {
    if (isRunning) return;
    isRunning = true;
    frameId = window.requestAnimationFrame(animate);
  }

  function stopRenderLoop() {
    if (!isRunning) return;
    isRunning = false;
    window.cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrameTime = 0;
  }

  function handleResize() {
    resize();
    scheduleScrollProgressUpdate();
  }

  function handlePointer(event) {
    pointerTargetX = clamp((event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2, -1, 1);
    pointerTargetY = clamp((event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2, -1, 1);
  }

  function handleContextLost(event) {
    event.preventDefault();
    mount.dataset.cubeRenderer = "disabled";
    stopRenderLoop();
  }

  resize();
  updateScrollProgress();
  const observer = new ResizeObserver(handleResize);
  observer.observe(mount);
  window.addEventListener("scroll", scheduleScrollProgressUpdate, { passive: true });
  window.addEventListener("resize", handleResize);
  if (supportsPointerFollow) {
    window.addEventListener("pointermove", handlePointer, { passive: true });
  }
  renderer.domElement.addEventListener("webglcontextlost", handleContextLost, false);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopRenderLoop();
      return;
    }
    updateScrollProgress();
    startRenderLoop();
  });
  startRenderLoop();

  window.addEventListener("pagehide", () => {
    stopRenderLoop();
    if (scrollFrameId) {
      window.cancelAnimationFrame(scrollFrameId);
      scrollFrameId = 0;
    }
    window.removeEventListener("scroll", scheduleScrollProgressUpdate);
    window.removeEventListener("resize", handleResize);
    if (supportsPointerFollow) {
      window.removeEventListener("pointermove", handlePointer);
    }
    renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
    observer.disconnect();
    renderer.dispose();
    boxGeometry.dispose();
    cubeGeometry.dispose();
    cubeMaterial.dispose();
    edgeSourceGeometry.dispose();
    edgeGeometry.dispose();
    edgeMaterial.dispose();
    shellGeometry.dispose();
    shellMaterial.dispose();
    shellEdgeGeometry.dispose();
    shellEdgeMaterial.dispose();
  }, { once: true });
} else if (mount) {
  mount.dataset.cubeProgress = "1.000";
  mount.dataset.cubeRenderer = "reduced-motion";
}
