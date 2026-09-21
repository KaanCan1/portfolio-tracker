const THREE_MODULE_URL = "/vendor/three/0.180.0/three.module.min.js";
const PREFERENCE_KEY = "portfolio:allocation-3d";
const MOBILE_QUERY = "(max-width: 640px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let card = null;
let stage = null;
let canvasHost = null;
let stateNode = null;
let toggle = null;
let currentSegments = [];
let visual = null;
let threePromise = null;
let resizeObserver = null;
let intersectionObserver = null;
let isIntersecting = false;
let mountToken = 0;

function savedPreference() {
  try { return localStorage.getItem(PREFERENCE_KEY) === "on"; } catch { return false; }
}

function savePreference(enabled) {
  try { localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off"); } catch {}
}

function eligibility() {
  if (matchMedia(MOBILE_QUERY).matches) return { allowed: false, reason: "3B görünüm telefonda kapalı; aynı veriler dağılım listesinde yer alır." };
  if (matchMedia(REDUCED_MOTION_QUERY).matches) return { allowed: false, reason: "Azaltılmış hareket tercihin nedeniyle 3B görünüm kapalı." };
  if (navigator.connection?.saveData) return { allowed: false, reason: "Veri tasarrufu açık olduğu için 3B görünüm yüklenmedi." };
  return { allowed: true, reason: "Varlık dağılımını 3B olarak göster." };
}

function normalizeSegments(snapshot) {
  const source = snapshot?.allocation;
  const raw = Array.isArray(source) ? source : (Array.isArray(source?.segs) ? source.segs : []);
  const segments = raw
    .map((item) => ({
      key: String(item?.key || item?.type || "other"),
      label: String(item?.label || "Diğer"),
      value: Number(item?.value),
      color: safeColor(item?.color),
    }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  return total > 0 ? segments.map((item) => ({ ...item, ratio: item.value / total })) : [];
}

function safeColor(value) {
  const color = typeof value === "string" ? value.trim() : "";
  return color && CSS.supports("color", color) ? color : "#687585";
}

function teardownMount() {
  mountToken += 1;
  disposeVisual();
  resizeObserver?.disconnect();
  intersectionObserver?.disconnect();
  resizeObserver = null;
  intersectionObserver = null;
  card = stage = canvasHost = stateNode = toggle = null;
  isIntersecting = false;
}

function mount(snapshot) {
  const nextStage = document.getElementById("deskAllocationVisual");
  if (!nextStage) {
    teardownMount();
    currentSegments = [];
    return;
  }
  if (nextStage !== stage) {
    teardownMount();
    stage = nextStage;
    card = stage.closest(".desk-allocation-card");
    currentSegments = normalizeSegments(snapshot);

    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn ghost sm desk-three-toggle";
    toggle.setAttribute("aria-controls", "deskAllocationVisual");
    toggle.setAttribute("aria-pressed", "false");
    toggle.textContent = "3B görünümü aç";
    toggle.addEventListener("click", onToggle);
    card?.querySelector(":scope > header")?.append(toggle);

    canvasHost = document.createElement("div");
    canvasHost.className = "desk-three-canvas";
    canvasHost.setAttribute("aria-hidden", "true");
    stateNode = document.createElement("span");
    stateNode.className = "desk-three-state";
    stateNode.setAttribute("role", "status");
    stage.append(canvasHost, stateNode);
    stage.addEventListener("webglcontextlost", onContextLost);

    resizeObserver = new ResizeObserver(() => visual?.resize());
    resizeObserver.observe(stage);
    intersectionObserver = new IntersectionObserver((entries) => {
      isIntersecting = Boolean(entries[0]?.isIntersecting);
      if (isIntersecting && !document.hidden) visual?.render();
    }, { rootMargin: "80px" });
    intersectionObserver.observe(stage);
  } else {
    const nextCard = stage.closest(".desk-allocation-card");
    if (nextCard !== card) card = nextCard;
    if (!toggle.isConnected) card?.querySelector(":scope > header")?.append(toggle);
    currentSegments = normalizeSegments(snapshot);
    visual?.update(currentSegments);
  }
  updateEligibility();
}

function updateEligibility() {
  if (!toggle) return;
  const state = eligibility();
  toggle.disabled = !state.allowed;
  toggle.title = state.reason;
  toggle.setAttribute("aria-label", state.reason);
  if (!state.allowed) {
    toggle.textContent = "3B görünüm kapalı";
    toggle.setAttribute("aria-pressed", "false");
    disposeVisual();
    return;
  }
  const enabled = Boolean(visual);
  toggle.textContent = enabled ? "3B görünümü kapat" : "3B görünümü aç";
  toggle.setAttribute("aria-pressed", String(enabled));
  toggle.setAttribute("aria-label", enabled ? "3B dağılım görünümünü kapat" : state.reason);
  if (!enabled && savedPreference() && currentSegments.length) enableVisual();
}

async function onToggle() {
  if (!eligibility().allowed) return;
  if (visual) {
    savePreference(false);
    disposeVisual();
    updateEligibility();
    return;
  }
  savePreference(true);
  await enableVisual();
}

async function enableVisual() {
  if (visual || !stage || !currentSegments.length || !eligibility().allowed) return;
  const requestedToken = mountToken;
  const requestedStage = stage;
  const requestedHost = canvasHost;
  toggle.disabled = true;
  stateNode.textContent = "3B görünüm yükleniyor…";
  stage.dataset.threeLoading = "true";
  let importAttempt;
  try {
    importAttempt = threePromise ||= import(THREE_MODULE_URL);
    const THREE = await importAttempt;
    if (requestedToken !== mountToken || requestedStage !== stage || !requestedStage.isConnected || visual || !eligibility().allowed) return;
    visual = createVisual(THREE, requestedHost);
    visual.update(currentSegments);
    stage.dataset.threeReady = "true";
    delete stage.dataset.threeLoading;
    stateNode.textContent = "";
    updateEligibility();
  } catch (error) {
    if (threePromise === importAttempt) threePromise = null;
    if (requestedToken !== mountToken) return;
    console.warn("3B dağılım görünümü yüklenemedi; erişilebilir 2B görünüm korunuyor.", error);
    savePreference(false);
    disposeVisual();
    stateNode.textContent = "3B görünüm açılamadı; dağılım listesi kullanılabilir.";
    toggle.textContent = "3B görünümü yeniden dene";
    toggle.disabled = false;
  }
}

function createVisual(THREE, host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
  camera.position.set(0, 3.7, 7.7);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa8b5, 2.15));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(3, 5, 5);
  scene.add(keyLight);

  const group = new THREE.Group();
  group.rotation.x = -.72;
  group.rotation.z = -.18;
  scene.add(group);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let meshes = [];
  let activeIndex = -1;
  let disposed = false;

  function requestRender() {
    if (!disposed && isIntersecting && !document.hidden) renderer.render(scene, camera);
  }

  function disposeMeshes() {
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      group.remove(mesh);
    }
    meshes = [];
  }

  function update(segments) {
    disposeMeshes();
    let angle = Math.PI / 2;
    const gap = Math.min(.026, (Math.PI * 2) / Math.max(segments.length, 1) * .08);
    segments.forEach((segment, index) => {
      const sweep = Math.max(.02, segment.ratio * Math.PI * 2 - gap);
      const geometry = new THREE.ExtrudeGeometry(arcShape(THREE, .92, 2.25, angle + gap / 2, angle + gap / 2 + sweep), {
        depth: .22 + segment.ratio * .28,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: .035,
        bevelThickness: .035,
        curveSegments: 42,
      });
      const material = new THREE.MeshStandardMaterial({
        color: segment.color,
        roughness: .58,
        metalness: .04,
        emissive: segment.color,
        emissiveIntensity: 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { index, baseZ: segment.ratio * .22 };
      mesh.position.z = mesh.userData.baseZ;
      group.add(mesh);
      meshes.push(mesh);
      angle += segment.ratio * Math.PI * 2;
    });
    activeIndex = -1;
    requestRender();
  }

  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }

  function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    meshes.forEach((mesh, meshIndex) => {
      mesh.material.emissiveIntensity = meshIndex === index ? .22 : 0;
      mesh.position.z = mesh.userData.baseZ + (meshIndex === index ? .045 : 0);
    });
    card?.querySelectorAll(".desk-allocation-list > div").forEach((row, rowIndex) => {
      row.classList.toggle("is-three-active", rowIndex === index);
    });
    requestRender();
  }

  function onPointerMove(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    setActive(raycaster.intersectObjects(meshes, false)[0]?.object?.userData?.index ?? -1);
  }

  const onPointerLeave = () => setActive(-1);
  renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: true });
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  resize();

  return {
    update,
    resize,
    render: requestRender,
    dispose() {
      disposed = true;
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      disposeMeshes();
      renderer.dispose();
      host.replaceChildren();
    },
  };
}

function arcShape(THREE, innerRadius, outerRadius, start, end) {
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(start) * outerRadius, Math.sin(start) * outerRadius);
  shape.absarc(0, 0, outerRadius, start, end, false);
  shape.lineTo(Math.cos(end) * innerRadius, Math.sin(end) * innerRadius);
  shape.absarc(0, 0, innerRadius, end, start, true);
  shape.closePath();
  return shape;
}

function disposeVisual() {
  visual?.dispose();
  visual = null;
  if (stage) {
    delete stage.dataset.threeReady;
    delete stage.dataset.threeLoading;
  }
}

function onContextLost(event) {
  event.preventDefault();
  console.warn("WebGL bağlamı kayboldu; 2B dağılım görünümüne dönüldü.");
  visual?.dispose();
  visual = null;
  if (stage) delete stage.dataset.threeReady;
  if (stateNode) stateNode.textContent = "3B görünüm durdu; dağılım listesi kullanılabilir.";
  if (toggle) {
    toggle.textContent = "3B görünümü yeniden dene";
    toggle.setAttribute("aria-pressed", "false");
    toggle.disabled = false;
  }
}

function refresh(event) {
  mount(event?.detail || window.PortfolioDeskSnapshot);
}

window.addEventListener("portfolio:updated", refresh);
window.addEventListener("resize", updateEligibility, { passive: true });
matchMedia(MOBILE_QUERY).addEventListener("change", updateEligibility);
matchMedia(REDUCED_MOTION_QUERY).addEventListener("change", updateEligibility);
navigator.connection?.addEventListener?.("change", updateEligibility);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && isIntersecting) visual?.render();
});
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh, { once: true });
else refresh();
