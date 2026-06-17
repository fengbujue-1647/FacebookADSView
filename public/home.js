const iconPaths = {
  "area-chart": ["M3 3v18h18", "m19 9-5 5-4-4-3 3"],
  "shield-check": ["M20 13c0 5-3.5 7.5-8 8.5-4.5-1-8-3.5-8-8.5V5l8-3 8 3v8Z", "m9 12 2 2 4-5"]
};

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

initIcons();
