import { useEffect, useState, type KeyboardEvent } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  THEME_MODE_DESCRIPTIONS,
  THEME_MODE_LABELS,
  THEME_MODES,
  isThemeMode,
  readStoredThemeMode,
  resolveIsDark,
  systemPrefersDark,
  type ThemeMode,
} from "../lib/appTheme";
import { cx } from "../lib/utils";

const MODE_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

function ThemeModeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mode, setMode] = useState<ThemeMode>(() => readStoredThemeMode());

  useEffect(() => {
    if (isThemeMode(theme)) setMode(theme);
  }, [theme]);

  const select = (next: ThemeMode) => {
    setMode(next);
    setTheme(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, option: ThemeMode) => {
    const index = THEME_MODES.indexOf(option);
    let next: ThemeMode;
    if (event.key === "Home") next = THEME_MODES[0];
    else if (event.key === "End") next = THEME_MODES[THEME_MODES.length - 1];
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = THEME_MODES[(index + 1) % THEME_MODES.length];
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = THEME_MODES[(index + THEME_MODES.length - 1) % THEME_MODES.length];
    } else return;
    event.preventDefault();
    select(next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-theme-mode="${next}"]`)?.focus();
  };

  const isDark = resolveIsDark(mode, systemPrefersDark());

  return (
    <div
      role="radiogroup"
      dir="rtl"
      aria-label="حالت رنگ"
      title={`حالت رنگ: ${THEME_MODE_LABELS[mode]} (${isDark ? "تیره" : "روشن"})`}
      className={cx("theme-mode-switch", className)}
    >
      {THEME_MODES.map((option) => {
        const Icon = MODE_ICONS[option];
        const checked = option === mode;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-theme-mode={option}
            aria-label={THEME_MODE_DESCRIPTIONS[option]}
            title={THEME_MODE_DESCRIPTIONS[option]}
            onClick={() => select(option)}
            onKeyDown={(event) => handleKeyDown(event, option)}
            className="theme-mode-switch__option"
          >
            <Icon size={15} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export { ThemeModeSwitch };
