import * as THREE from "/vendor/three.module.js";

const mount = document.querySelector("[data-home-cube]");
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

if (mount && !reduceMotion) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0xffffff, 0);
  mount.appendChild(renderer.domElement);

  const group = new THREE.Group();
  scene.add(group);

  const clusterCount = 6;
  const unitsPerCluster = 27;
  const cubeCount = clusterCount * unitsPerCluster;
  const geometry = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xf5f8ff,
    roughness: 0.18,
    metalness: 0,
    transmission: 0.58,
    thickness: 0.18,
    transparent: true,
    opacity: 0.62
  });
  const mesh = new THREE.InstancedMesh(geometry, material, cubeCount);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(mesh);

  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x0052d9,
    transparent: true,
    opacity: 0.22
  });
  const edgeMesh = new THREE.InstancedMesh(edgeGeometry, edgeMaterial, cubeCount);
  edgeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(edgeMesh);

  scene.add(new THREE.AmbientLight(0xeaf2ff, 1.9));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(5, 7, 8);
  scene.add(keyLight);
  const blueLight = new THREE.PointLight(0x0052d9, 1.4, 18);
  blueLight.position.set(-3, 2.8, 5);
  scene.add(blueLight);

  const dummy = new THREE.Object3D();
  const drift = new THREE.Vector3();
  const points = [];
  const color = new THREE.Color();
  const colorA = new THREE.Color(0xffffff);
  const colorB = new THREE.Color(0xdde8ff);
  const gridCenters = [
    [-1.5, 1.0, 0],
    [0, 1.0, 0],
    [1.5, 1.0, 0],
    [-1.5, -0.52, 0],
    [0, -0.52, 0],
    [1.5, -0.52, 0]
  ];

  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const [cx, cy, cz] = gridCenters[cluster];
    for (let local = 0; local < unitsPerCluster; local += 1) {
      const index = cluster * unitsPerCluster + local;
      const x = local % 3;
      const y = Math.floor(local / 3) % 3;
      const z = Math.floor(local / 9);
      const target = new THREE.Vector3(
        cx + (x - 1) * 0.22,
        cy + (y - 1) * 0.22,
        cz + (z - 1) * 0.22
      );
      const angle = index * 0.62;
      const radius = 1.35 + (index % 13) * 0.07;
      const scatter = new THREE.Vector3(
        Math.cos(angle) * radius + (cluster - 2.5) * 0.18,
        Math.sin(index * 0.37) * 1.4 + (index % 5) * 0.08,
        Math.sin(angle) * radius * 0.7 + Math.cos(index * 0.19) * 0.8
      );
      points.push({
        scatter,
        target,
        current: scatter.clone(),
        rotationSeed: index * 0.131,
        scale: 0.72 + (index % 5) * 0.035
      });
      mesh.setColorAt(index, color.copy(colorA).lerp(colorB, (index % 9) / 8));
    }
  }
  mesh.instanceColor.needsUpdate = true;

  let width = 1;
  let height = 1;
  let pointerX = 0;
  let pointerY = 0;
  let scrollProgress = 0;
  let smoothProgress = 0;
  let frameId = 0;
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
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.set(width < 760 ? 0 : 0.2, width < 760 ? 0.45 : 0.2, width < 760 ? 8.4 : 7.2);
    camera.updateProjectionMatrix();
  }

  function updateScrollProgress() {
    const target = document.querySelector("[data-cube-target]");
    if (!target) {
      scrollProgress = clamp(window.scrollY / Math.max(1, window.innerHeight), 0, 1);
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

  function animate(timeMs) {
    const time = timeMs * 0.001;
    const delta = scrollProgress - smoothProgress;
    smoothProgress += delta * Math.min(0.12, 0.055 + Math.abs(delta) * 0.09);
    const t = easeInOut(smoothProgress);

    points.forEach((point, index) => {
      drift.set(
        Math.sin(time * 0.46 + index * 0.17) * (1 - t) * 0.18,
        Math.cos(time * 0.38 + index * 0.11) * (1 - t) * 0.12,
        Math.sin(time * 0.3 + index * 0.13) * (1 - t) * 0.14
      );
      point.current.lerpVectors(point.scatter, point.target, t).add(drift);
      dummy.position.copy(point.current);
      dummy.rotation.set(
        point.rotationSeed + time * 0.34 * (1 - t),
        point.rotationSeed * 1.7 + time * 0.28 * (1 - t),
        point.rotationSeed * 0.7 + time * 0.22 * (1 - t)
      );
      dummy.scale.setScalar(point.scale + t * 0.22);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      edgeMesh.setMatrixAt(index, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    edgeMesh.instanceMatrix.needsUpdate = true;
    group.rotation.y = -0.24 + pointerX * 0.05 + (1 - t) * Math.sin(time * 0.14) * 0.08;
    group.rotation.x = -0.08 + pointerY * 0.04 + t * 0.05;
    group.position.x = width < 760 ? 0.02 : 1.95 - t * 1.75;
    group.position.y = width < 760 ? -0.58 + t * 0.42 : -0.18 + t * 0.1;
    group.scale.setScalar(width < 760 ? 0.86 : 1);

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
  }

  function handlePointer(event) {
    const rect = mount.getBoundingClientRect();
    pointerX = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
    pointerY = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
  }

  resize();
  updateScrollProgress();
  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  window.addEventListener("resize", updateScrollProgress);
  window.addEventListener("pointermove", handlePointer, { passive: true });
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
    observer.disconnect();
    renderer.dispose();
    geometry.dispose();
    material.dispose();
    edgeGeometry.dispose();
    edgeMaterial.dispose();
  }, { once: true });
} else if (mount) {
  mount.dataset.cubeProgress = "1.000";
}
