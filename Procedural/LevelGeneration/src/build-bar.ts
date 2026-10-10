import { BUILDING_PROFILES, type Profile } from "./core/document";
import type { ObjectCategory } from "./core/scene-inputs";

export type EditMode = "building" | "object" | "road" | "sidewalk" | "parking" | "inspect";
export interface BuildTool { mode: EditMode; style?: Profile; category?: ObjectCategory }

const svg = (body: string) => `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const house = (fill: string, extra = "") => svg(`<path d="M8 14v14h16V14" fill="${fill}"/><path d="M4 16 16 6l12 10"/><path d="M14 28v-6h4v6"/>${extra}`);
const MODE_ICONS: Record<Exclude<EditMode, "building" | "object">, [string, string]> = {
  inspect: ["원본·생성물 선택", svg('<path d="M9 5v19l5-5 4 8 3-1.5-4-8h7z"/>')],
  road: ["도로 설치", svg('<path d="M12 4 6 28M20 4l6 24"/><path d="M16 5v4M16 14v4M16 23v4" stroke-width="2.2"/>')],
  sidewalk: ["인도 설치", svg('<rect x="4" y="5" width="24" height="22" rx="1"/><path d="M4 12h24M4 19h24M12 5v7M20 12v7M12 19v8"/>')],
  parking: ["주차장·차고 설치", svg('<rect x="4" y="4" width="24" height="24" rx="3"/><path d="M12 23V9h5a4 4 0 0 1 0 8h-5"/>')],
};
const STYLE_ICONS: Record<Profile, string> = {
  shop: svg('<rect x="7" y="4" width="18" height="24"/><path d="M7 10h18M7 16h18M7 22h18" stroke-width="3.2" stroke-linecap="butt"/>'),
  office: svg('<rect x="7" y="4" width="18" height="24"/><path d="M7 10h18M7 16h18M7 22h18M13 4v24M19 4v24"/>'),
  "urban-shop": svg('<path d="M7 28V4h11a7 7 0 0 1 7 7v17z"/><path d="M7 11h18M7 17h18M7 23h18"/>'),
  "tower11-d": svg('<path d="M9 28V12h4V4h6v8h4v16z"/><path d="M16 8v20M13 16h6M13 21h6"/>'),
  "residential-cream": house("#e6d6ad55"),
  "residential-red": house("#b5523f88"),
  "residential-brick": house("#8f4d3a66", '<path d="M8 18h16M8 22h6M18 22h6M12 18v4M20 18v4"/>'),
  "residential-garage": house("#e6d6ad33", '<path d="M18 28v-7h6M18 24h6"/>'),
};
const OBJECTS: [ObjectCategory, string, string][] = [
  ["lighting", "조명", svg('<path d="M11 28h8M15 28V9a4 4 0 0 1 4-4h4"/><path d="M21 5h5l1 4h-7z" fill="currentColor"/><path d="M23 12v2M19 12l-1 2M27 12l1 2"/>')],
  ["vegetation", "식생", svg('<circle cx="16" cy="12" r="7.5"/><path d="M16 19.5V28M11 28h10M16 22l-3-3M16 20l3-3"/>')],
  ["facility", "시설", svg('<path d="M6 4v24M26 4v24"/><path d="M6 10h20M6 18h20M6 26h20"/><path d="M10 26l6-8M16 18l6-8"/>')],
];

export const styleLabel = (style: Profile) => `건물 · ${BUILDING_PROFILES[style].label}`;
export function toolLabel(tool: BuildTool) {
  if (tool.mode === "building") return styleLabel(tool.style!);
  if (tool.mode === "object") return `오브젝트 · ${OBJECTS.find(o => o[0] === tool.category)![1]}`;
  return MODE_ICONS[tool.mode][0];
}
const button = (data: string, label: string, icon: string, badge = "") =>
  `<button type="button" class="build-tool" ${data} aria-pressed="false" title="${label}" aria-label="${label}">${icon}${badge ? `<span class="tool-badge">${badge}</span>` : ""}</button>`;

export function buildBarHTML() {
  const mode = (m: keyof typeof MODE_ICONS) => button(`data-tool="${m}"`, MODE_ICONS[m][0], MODE_ICONS[m][1]);
  const styles = (Object.keys(BUILDING_PROFILES) as Profile[]).map(id => {
    const label = BUILDING_PROFILES[id].label;
    return button(`data-tool="building" data-style="${id}"`, styleLabel(id), STYLE_ICONS[id], label.length <= 2 ? label : "");
  }).join("");
  const objects = OBJECTS.map(([id, label, icon]) => button(`data-tool="object" data-object="${id}"`, `오브젝트 · ${label}`, icon)).join("");
  return `<div class="build-caption" id="build-caption" aria-live="polite"></div>
  <div class="build-tools" role="toolbar" aria-label="건설 도구">
    <div class="tool-group">${mode("inspect")}</div>
    <div class="tool-group" aria-label="지면">${mode("road")}${mode("sidewalk")}${mode("parking")}</div>
    <div class="tool-group" aria-label="건물 스타일">${styles}</div>
    <div class="tool-group" aria-label="오브젝트">${objects}</div>
  </div>`;
}
export function toolFromButton(b: HTMLElement): BuildTool {
  return { mode: b.dataset.tool as EditMode, style: b.dataset.style as Profile | undefined, category: b.dataset.object as ObjectCategory | undefined };
}
/** Marks the active tool and, while a building is selected, the style it currently uses. */
export function syncBuildBar(root: HTMLElement, tool: BuildTool, selectedStyle?: string) {
  for (const b of root.querySelectorAll<HTMLButtonElement>(".build-tool")) {
    const t = toolFromButton(b);
    b.setAttribute("aria-pressed", String(t.mode === tool.mode && (t.mode !== "building" || t.style === tool.style) && (t.mode !== "object" || t.category === tool.category)));
    b.classList.toggle("current", !!selectedStyle && t.style === selectedStyle);
  }
}

/** Icons for the viewport HUD buttons and menus. */
export const HUD_ICONS = {
  new: svg('<path d="M8 4h11l5 5v19H8z"/><path d="M19 4v5h5M16 14v9M11.5 18.5h9"/>'),
  load: svg('<path d="M4 9h9l2 3h13v14H4z"/><path d="M16 23v-8M12.5 18.5 16 15l3.5 3.5"/>'),
  save: svg('<path d="M16 5v14M10.5 13.5 16 19l5.5-5.5"/><path d="M6 21v6h20v-6"/>'),
  generate: svg('<rect x="5" y="5" width="22" height="22" rx="4"/><circle cx="11" cy="11" r="1.6" fill="currentColor"/><circle cx="21" cy="21" r="1.6" fill="currentColor"/><circle cx="16" cy="16" r="1.6" fill="currentColor"/><circle cx="21" cy="11" r="1.6" fill="currentColor"/><circle cx="11" cy="21" r="1.6" fill="currentColor"/>'),
  layers: svg('<path d="M16 5 4 11l12 6 12-6z"/><path d="m4 16 12 6 12-6M4 21l12 6 12-6"/>'),
  help: svg('<circle cx="16" cy="16" r="12"/><path d="M12.5 12.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v1"/><circle cx="16" cy="23" r="1" fill="currentColor"/>'),
  inspect: svg('<circle cx="14" cy="14" r="8"/><path d="m20 20 7 7M14 10v4M14 17.5v.5"/>'),
};
