const iconPaths = {
  "area-chart": ["M3 3v18h18", "m19 9-5 5-4-4-3 3"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "shield-check": ["M20 13c0 5-3.5 7.5-8 8.5-4.5-1-8-3.5-8-8.5V5l8-3 8 3v8Z", "m9 12 2 2 4-5"]
};

const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

function initIcons() {
  document.querySelectorAll("i[data-lucide]").forEach((icon) => {
    const paths = iconPaths[icon.dataset.lucide];
    if (!paths) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    paths.forEach((definition) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", definition);
      svg.appendChild(path);
    });
    icon.replaceChildren(svg);
  });
}

function initHomeNav() {
  const nav = document.querySelector("[data-home-nav]");
  const trigger = nav?.querySelector("[data-home-nav-trigger]");
  if (!nav || !trigger) return;

  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  };

  trigger.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
  document.addEventListener("click", (event) => {
    if (nav.contains(event.target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setOpen(false);
    trigger.focus();
  });
}

function initReveal() {
  const nodes = document.querySelectorAll(".reveal");
  if (!nodes.length) return;

  const staggerGroups = [
    ".capability-grid",
    ".model-grid",
    ".tech-grid",
    ".case-grid",
    ".deploy-grid"
  ];

  staggerGroups.forEach((selector) => {
    document.querySelectorAll(`${selector} .reveal`).forEach((node, index) => {
      node.style.setProperty("--reveal-delay", `${Math.min(index * 36, 216)}ms`);
    });
  });

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -12% 0px",
    threshold: 0.12
  });

  nodes.forEach((node) => observer.observe(node));
}

function initLoader() {
  const loader = document.querySelector("[data-loader]");
  if (!loader) return;
  const hide = () => loader.classList.add("is-hidden");
  if (prefersReducedMotion) {
    hide();
    return;
  }
  window.setTimeout(hide, 680);
  window.addEventListener("load", hide, { once: true });
}

function initArchitectureProgress() {
  const section = document.querySelector("#architecture");
  if (!section) return;
  let frameId = 0;

  const update = () => {
    frameId = 0;
    const rect = section.getBoundingClientRect();
    const viewport = window.innerHeight || 1;
    const total = rect.height + viewport * 0.6;
    const raw = (viewport * 0.82 - rect.top) / total;
    const progress = Math.min(1, Math.max(0, raw));
    section.style.setProperty("--arch-progress", progress.toFixed(4));
  };

  const scheduleUpdate = () => {
    if (frameId) return;
    frameId = window.requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
}

initIcons();
initHomeNav();
initReveal();
initLoader();
initArchitectureProgress();
