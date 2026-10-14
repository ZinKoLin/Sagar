/**
 * Presentation preferences (theme, text zoom, pane sizes). These are stored
 * separately from translations and never authoritative content.
 */

export type ThemePreference = "system" | "light" | "dark";

const KEYS = {
  theme: "sagar.theme",
  zoom: "sagar.textZoom",
  sidebarWidth: "sagar.sidebarWidth",
  sourceWidth: "sagar.sourceWidth",
  translationTimeout: "sagar.aiTranslation.timeoutMinutes.v1",
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Presentation preferences are best-effort only.
  }
}

export function loadTheme(): ThemePreference {
  const value = read(KEYS.theme);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function saveTheme(theme: ThemePreference): void {
  write(KEYS.theme, theme);
}

export function loadTextZoom(): number {
  const value = Number(read(KEYS.zoom));
  return Number.isFinite(value) && value >= 14 && value <= 28 ? value : 18;
}

export function saveTextZoom(size: number): void {
  write(KEYS.zoom, String(size));
}

export function loadTranslationTimeout(): number {
  const stored = read(KEYS.translationTimeout);
  if (stored === null) return 120;
  const minutes = Number(stored);
  return [0, 60, 120, 240].includes(minutes) ? minutes : 120;
}

export function saveTranslationTimeout(minutes: number): void {
  if ([0, 60, 120, 240].includes(minutes))
    write(KEYS.translationTimeout, String(minutes));
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function loadSidebarWidth(): number {
  const value = Number(read(KEYS.sidebarWidth));
  return Number.isFinite(value) ? clampWidth(value, 200, 360) : 240;
}

export function saveSidebarWidth(value: number): void {
  write(KEYS.sidebarWidth, String(clampWidth(value, 200, 360)));
}

export function loadSourceWidth(): number {
  const stored = read(KEYS.sourceWidth);
  if (stored === null) return 0;
  const value = Number(stored);
  return Number.isFinite(value) ? clampWidth(value, 320, 2000) : 0;
}

export function saveSourceWidth(value: number): void {
  write(KEYS.sourceWidth, String(clampWidth(value, 320, 2000)));
}
