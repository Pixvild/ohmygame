import { readFileSync } from "node:fs";
import path from "node:path";
import type { PlayablePreset } from "./playable-presets.js";

/** Stills from the supplied Last Bus project, resized to 1280 × 720 WebP. */
const PICTURES = {
  blank: "cover",
  "main-menu": "menu",
  choice: "phone",
  qte: "bell",
  hotspot: "cabin",
  ending: "ending",
  "story-map": "store-window",
  "visual-novel": "station",
} as const;

/** Keep the illustration in project-owned CSS, copied only when first needed. */
export function withPlayableTemplateArtwork(
  preset: PlayablePreset,
): PlayablePreset {
  const picture = PICTURES[preset.id];
  const file = `shared/templates/lastbus-${picture}.css`;
  const image = readFileSync(
    path.join(import.meta.dirname, "assets/scene-templates", `${picture}.webp`),
  ).toString("base64");
  return {
    ...preset,
    source: (title, id) => {
      const source = preset.source(title, id);
      return { ...source, css: `@import "../../${file}";\n${source.css}` };
    },
    sharedFiles: {
      ...preset.sharedFiles,
      [file]: `/* Last Bus template artwork. Setting a background in the editor replaces it. */
.has-backdrop {
  --letterbox: 0cqw;
}

.has-backdrop .backdrop[data-media="backdrop"]:not([data-asset]) {
  background: linear-gradient(rgb(0 0 0 / 0.18), rgb(0 0 0 / 0.35)),
    url("data:image/webp;base64,${image}") center / cover no-repeat;
}

/* Hide the former placeholder figure or window, including in existing projects. */
.has-backdrop .backdrop[data-media="backdrop"]:not([data-asset])::before {
  display: none;
}
`,
    },
  };
}
