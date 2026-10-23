import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * 표시 설정 — html[data-theme · data-density · data-sign] 을 바꾸고 localStorage 에 둔다.
 * theme "light" | "dark" | "system"(data-theme 을 지워 OS 설정을 따른다) · density "default" | "ledger" · sign "kr"(상승 적) | "global"(상승 녹)
 * useTheme() → { ...설정, resolvedTheme, setTheme, setSign }
 */

const STORAGE_KEY = "hja.display";
const DEFAULTS = { theme: "light", density: "default", sign: "kr" };

const ThemeContext = createContext(null);

function readStored() {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function systemPrefersDark() {
  if (typeof matchMedia === "undefined") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }) {
  const [prefs, setPrefs] = useState(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // OS 다크 설정 추적 — theme="system" 일 때 resolvedTheme 이 따라간다
  useEffect(() => {
    if (typeof matchMedia === "undefined") return undefined;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);

    if (prefs.density === "default") root.removeAttribute("data-density");
    else root.setAttribute("data-density", prefs.density);

    root.setAttribute("data-sign", prefs.sign);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* 저장 실패는 표시에 영향 없음 */
    }
  }, [prefs]);

  const set = useCallback((patch) => setPrefs((p) => ({ ...p, ...patch })), []);

  const resolvedTheme = prefs.theme === "system" ? (systemDark ? "dark" : "light") : prefs.theme;

  const value = useMemo(
    () => ({
      ...prefs,
      resolvedTheme,
      setTheme: (theme) => set({ theme }),
      setSign: (sign) => set({ sign }),
    }),
    [prefs, resolvedTheme, set],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
