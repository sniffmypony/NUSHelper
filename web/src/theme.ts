import { useSyncExternalStore } from "react";

// Light, Dark or System (follow the device). The choice is kept in this
// browser; index.html applies it before the first paint so the page never
// flashes the wrong theme.

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "nh-theme";
// For the browser's own UI (address bar): the page colour.
const THEME_COLOR = { light: "#f9f6f2", dark: "#110f0d" };

const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function resolve(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return media().matches ? "dark" : "light";
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  const mode = resolve(choice);
  // Transitions are off for the switch itself, so every colour on the page
  // changes at once instead of fading.
  root.classList.add("theme-switching");
  root.classList.toggle("dark", mode === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[mode]);
  void getComputedStyle(root).color;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.classList.remove("theme-switching")),
  );
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
  current = choice;
  applyTheme(choice);
  listeners.forEach((listener) => listener());
}

let current: ThemeChoice = storedTheme();

export function startTheme(): void {
  applyTheme(current);
  media().addEventListener("change", () => {
    if (current === "system") applyTheme("system");
  });
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
