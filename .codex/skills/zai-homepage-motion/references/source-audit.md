# Source Audit

This reference condenses three external motion/interaction skills into project-specific guidance for the ZAI AI homepage.

## Sources Reviewed

- LottieFiles `motion-design-skill`, commit `f9a8a04`
  - Useful for motion personality, timing/easing tables, choreography, quality gates.
- kylezantos `design-motion-principles`, commit `4a9ca87`
  - Useful for frequency gating, anti-pattern detection, audit discipline, performance and accessibility checks.
- aiskillstore `interaction-design`, fetched from `skills/wshobson/interaction-design/SKILL.md`
  - Useful for microinteraction purposes, CSS timing basics, reduced-motion and transform/opacity performance guidance.

Raw source copies are kept under `artifacts/motion-source-*` and are intentionally ignored by git.

## Adopt

- Motion must have a job: feedback, orientation, continuity, or narrative.
- Use one consistent personality: premium corporate engineering.
- Use `cubic-bezier(0.16, 1, 0.3, 1)` as the default entrance and feedback curve.
- Keep hover/press feedback fast: hover under 100ms perceived latency, press under 150ms.
- Use 200-350ms for cards and small panels; 600-800ms is acceptable only for rare section reveal or hero narrative moments.
- Make scroll-bound motion continuous and lerped.
- Keep Three.js work instanced, capped by pixel ratio, and disposed on `pagehide`.
- Respect `prefers-reduced-motion` in both CSS and JavaScript.

## Reject For This Homepage

- Bounce springs, playful overshoot, celebration particles, ripple effects, or hover-scale-on-everything.
- Pulsing indicators, breathing CTAs, glowing dots, or decorative loops not tied to the cube narrative.
- Blur-everywhere entrance patterns on headings and body copy.
- Stagger spam across every grid/list.
- Large full-screen parallax, zoom, spin, or vestibular-heavy motion.
- New animation frameworks for a static Node + HTML page.

## Project Interpretation

The cube background is the only ambient/continuous animation. It should feel like a precise engineering assembly, not a magic effect. All DOM motion is secondary and should stay nearly invisible: section reveal, hover feedback, nav dropdown, CTA inversion, and the architecture line draw.

When improving the homepage, favor:

- More consistent timing variables.
- Subtle section/grid stagger controlled by CSS variables.
- Better reduced-motion handling.
- Better scroll progress mapping and render throttling.
- Small visual feedback refinements that preserve hard minimalism.
