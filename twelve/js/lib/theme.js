// Light / dark mode. The script at the top of index.html applies the theme
// before the first paint and keeps "system" in sync with the phone's setting.
const KEY = "twelve.theme";

export const THEME_CHOICES = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

export function themeChoice() {
  try {
    const c = localStorage.getItem(KEY);
    return c === "light" || c === "dark" ? c : "system";
  } catch {
    return "system";
  }
}

export function setThemeChoice(choice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* private mode: applies for this visit only */ }
  if (window.twelveApplyTheme) window.twelveApplyTheme();
  else document.documentElement.setAttribute("data-theme", choice === "dark" ? "dark" : "light");
}
