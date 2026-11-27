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

// Light / Dark / System as a segmented control (Settings).
export function ThemeSwitch({ labels = false }: { labels?: boolean }) {
  const theme = useTheme();
  const styles = {
    box: "border border-line bg-sunken",
    on: "bg-surface text-ink shadow-card",
    off: "text-muted hover:text-ink",
  };
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex rounded-lg p-0.5 ${styles.box}`}
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
              theme === value ? styles.on : styles.off
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

// One button that steps Light → Dark → System: an icon in the phone's top
// bar, or a labelled row ("Dark theme") at the foot of the sidebar.
export function ThemeButton({ labelled = false }: { labelled?: boolean }) {
  const theme = useTheme();
  const label = CHOICES.find((choice) => choice.value === theme)!.label;
  const next = CHOICES.find((choice) => choice.value === NEXT[theme])!.label;
  const button = (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`Theme: ${label}. Switch to ${next}`}
      className={`inline-flex items-center gap-3 rounded-[10px] text-nav-muted transition-[transform,background-color,color] duration-150 ease-out hover:bg-nav-hover hover:text-nav-ink focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.97] motion-reduce:active:scale-100 ${
        labelled
          ? "w-full px-3 py-2 text-sm font-medium"
          : "h-9 w-9 justify-center"
      }`}
    >
      <SwapIcon
        show={theme}
        icons={{
          light: <Sun {...ICON} size={18} />,
          dark: <Moon {...ICON} size={18} />,
          system: <Monitor {...ICON} size={18} />,
        }}
      />
      {labelled && <span>{label} theme</span>}
    </button>
  );
  return labelled ? (
    <Tooltip label={`Switch to ${next}`}>{button}</Tooltip>
  ) : (
    button
  );
}
