import { Monitor, Moon, Sun } from "lucide-react";
import { setTheme, useTheme, type ThemeChoice } from "../theme";
import { ICON } from "./icons";
import { SwapIcon, Tooltip } from "./motion";

const CHOICES: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> =
  [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

// Light / Dark / System as a segmented control (Settings and the sidebar).
export function ThemeSwitch({ labels = false }: { labels?: boolean }) {
  const theme = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-line bg-sunken p-0.5"
    >
      {CHOICES.map(({ value, label, icon: Icon }) => {
        const button = (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={labels ? undefined : label}
            onClick={() => setTheme(value)}
            // Inner radius = 8 px outer − 2 px padding.
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 ${
              theme === value
                ? "bg-surface text-ink shadow-card"
                : "text-muted hover:text-ink"
            }`}
          >
            <Icon {...ICON} />
            {labels && label}
          </button>
        );
        return labels ? (
          button
        ) : (
          <Tooltip key={value} label={label}>
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  light: "dark",
  dark: "system",
  system: "light",
};

// One button that steps Light → Dark → System (the phone's top bar).
export function ThemeButton() {
  const theme = useTheme();
  const label = CHOICES.find((choice) => choice.value === theme)!.label;
  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`Theme: ${label}. Change theme`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-[transform,background-color,color] duration-150 ease-out hover:bg-hover hover:text-ink active:scale-[0.97] motion-reduce:active:scale-100"
    >
      <SwapIcon
        show={theme}
        icons={{
          light: <Sun {...ICON} size={18} />,
          dark: <Moon {...ICON} size={18} />,
          system: <Monitor {...ICON} size={18} />,
        }}
      />
    </button>
  );
}
