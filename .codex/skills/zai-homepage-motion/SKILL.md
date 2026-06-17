---
name: zai-homepage-motion
description: Audit and refine the ZAI AI homepage motion system. Use when editing public/index.html, public/home.css, public/home.js, or public/home-cube.js for the "智在 AI" homepage, especially scroll-bound cube animation, viewport reveal, hover feedback, CTA motion, reduced-motion support, or motion-design review.
---

# ZAI Homepage Motion

Use this skill to keep the "智在 AI" homepage motion premium, restrained, and engineering-grade. The page is a real B2B homepage, not a dashboard and not a generic SaaS landing page.

## Source Synthesis

Read [source-audit.md](references/source-audit.md) before making motion changes. It records which ideas were adopted from:

- `LottieFiles/motion-design-skill`
- `kylezantos/design-motion-principles`
- `aiskillstore/interaction-design`

## Motion Identity

- Personality: premium corporate engineering.
- Emotional target: calm confidence, precision, credible technical depth.
- Signature easing: `cubic-bezier(0.16, 1, 0.3, 1)` for entrances and UI feedback.
- Use no bounce, no playful overshoot, no pulsing status indicators, no decorative blur-everywhere pattern.
- Use Professional Blue `#0052D9` only as a technical guide/accent, not as a glowing entertainment effect.

## Workflow

1. Preserve the current homepage direction first: white space, black/gray type, thin lines, sharp corners, cube background.
2. Create a backup under `artifacts/` before visual experiments.
3. Audit motion with the checklist below.
4. Make the smallest improvement that fixes the highest-value issue.
5. Verify with syntax checks and the in-app browser on desktop and mobile widths.

## Audit Checklist

- Purpose: each animation should provide orientation, feedback, continuity, or the cube assembly narrative.
- Frequency: high-frequency UI interactions stay instant or under 180ms.
- Entrances: use opacity + `translateY(20px)` only for section-level reveal; avoid animating every text fragment.
- Stagger: use one subtle cascade per dense grid at most; total stagger must stay under 500ms.
- Hover: use border/background/2-4px translate feedback; avoid hover-scale on repeated cards.
- CTA: black/white inversion plus 2px text advance is enough.
- Scroll animation: cube progress must be scroll-bound and lerped, not one-shot trigger animation.
- Three.js performance: prefer instancing, capped pixel ratio, transform updates, and pause/dispose paths.
- Accessibility: respect `prefers-reduced-motion`; decorative/ambient motion can be disabled.
- Layout: do not animate width, height, top, left, margin, padding, or font-size.

## Homepage-Specific Rules

- Keep `public/home-cube.js` as the only 3D motion surface unless the user asks for a larger rebuild.
- The cube motion story is: scattered cloud in Hero -> precise 6-matrix assembly near capabilities.
- Keep scroll progress inspectable through `data-cube-progress`.
- Do not add GSAP, Framer Motion, React, or another framework for this static page.
- Do not add shadows, gradients, rounded corners, glow blobs, or decorative animated assets that violate the current brand system.
- Do not convert the homepage into a tool workspace or admin interface.

## Validation

Run at least:

```powershell
node --check public/home.js
Get-Content -Raw public/home-cube.js | node --input-type=module --check
git diff --check
```

Then use the in-app browser to confirm:

- No console errors.
- No horizontal overflow at desktop and mobile widths.
- The cube canvas renders and `data-cube-progress` moves from near `0` toward `1` while scrolling.
- Reduced motion disables decorative movement without breaking content.
