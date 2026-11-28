import { Monitor, Moon, Sun } from "lucide-react";
import { setTheme, useTheme, type ThemeChoice } from "../theme";
import { ICON } from "./icons";
import { SwapIcon, Tooltip } from "./motion";
import { Segmented } from "./Segmented";

const CHOICES: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> =
  [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

// Light / Dark / System as a segmented control (Settings, the phone's More
// sheet). The colours switch at once, without a page-wide fade.
export function ThemeSwitch({ labels = true }: { labels?: boolean }) {
  const theme = useTheme();
  return (
    <Segmented
      label="Theme"
      value={theme}
      onChange={setTheme}
      size="sm"
      options={CHOICES.map(({ value, label, icon: Icon }) => ({
        value,
        title: labels ? undefined : label,
        label: (
          <>
            <Icon {...ICON} size={15} />
            {labels ? label : <span className="sr-only">{label}</span>}
          </>
        ),
      }))}
    />
  );
}

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  light: "dark",
  dark: "system",
  system: "light",
};

// One button that steps Light → Dark → System, at the foot of the sidebar.
// `compact` is the icon-only form (tablet rail).
export function ThemeButton({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const label = CHOICES.find((choice) => choice.value === theme)!.label;
  const next = CHOICES.find((choice) => choice.value === NEXT[theme])!.label;
  const button = (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`Theme: ${label}. Switch to ${next}`}
      className={`inline-flex h-9 items-center gap-3 rounded-lg text-sm font-medium text-muted transition-[transform,background-color,color] duration-[var(--dur-fast)] ease-out hover:bg-hover hover:text-ink active:scale-[0.97] motion-reduce:active:scale-100 ${
        compact ? "w-10 justify-center" : "w-full px-3"
      }`}
    >
      <SwapIcon
        show={theme}
        icons={{
          light: <Sun {...ICON} size={17} />,
          dark: <Moon {...ICON} size={17} />,
          system: <Monitor {...ICON} size={17} />,
        }}
      />
      {!compact && <span>{label} theme</span>}
    </button>
  );
  return <Tooltip label={`Switch to ${next}`}>{button}</Tooltip>;
}
