import { TriangleAlert } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ICON } from "./icons";
import { Button } from "./ui";

// Confirmations for changes that can't be undone (web/DESIGN.md §4):
// deleting a Google Calendar event or a chat, replacing a key, signing out
// everywhere. Reversible changes use Undo instead (feedback.tsx).
// `await confirm({...})` resolves true only when the named action is chosen.

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("ConfirmProvider is missing");
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const confirm: Confirm = useCallback((next) => {
    resolver.current?.(false);
    setOptions(next);
    // Opened after React has rendered the new text.
    requestAnimationFrame(() => dialog.current?.showModal());
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    dialog.current?.close();
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="confirm-title"
        aria-describedby={options?.body ? "confirm-body" : undefined}
        onCancel={() => {
          resolver.current?.(false);
          resolver.current = null;
        }}
        onClick={(event) => {
          // A click on the backdrop (the dialog element itself) cancels.
          if (event.target === dialog.current) finish(false);
        }}
        className="confirm m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-line bg-raised p-0 text-ink shadow-pop"
      >
        {options && (
          <div className="p-5">
            <div className="flex items-start gap-3">
              {options.danger && (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
                  <TriangleAlert {...ICON} size={18} />
                </span>
              )}
              <div className="min-w-0 pt-1">
                <h2 id="confirm-title" className="text-base font-semibold">
                  {options.title}
                </h2>
                {options.body && (
                  <div id="confirm-body" className="mt-1.5 text-sm text-muted">
                    {options.body}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                autoFocus
                onClick={() => finish(false)}
              >
                {options.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={options.danger ? "danger" : "primary"}
                onClick={() => finish(true)}
              >
                {options.confirmLabel}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
