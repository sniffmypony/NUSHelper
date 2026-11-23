import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { TelegramLogin } from "../components/TelegramLogin";

export function SignIn({
  onSignedIn,
  title = "Sign in to NUSHelper",
  description = "Use the Telegram account that owns your bot.",
}: {
  onSignedIn: () => void;
  title?: string;
  description?: string;
}) {
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ botUsername: string }>("config")
      .then((config) => setBotUsername(config.botUsername))
      .catch((failure: Error) => setError(failure.message));
  }, []);

  const onAuth = useCallback(
    (user: Record<string, unknown>) => {
      setError(null);
      api("auth/telegram", { method: "POST", body: user })
        .then(onSignedIn)
        .catch((failure: Error) => setError(failure.message));
    },
    [onSignedIn],
  );

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>
      {botUsername ? (
        <TelegramLogin botUsername={botUsername} onAuth={onAuth} />
      ) : (
        !error && <p className="text-sm text-slate-400">Loading…</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <img src="/favicon.svg" alt="" className="mx-auto mb-6 h-12 w-12" />
        <SignIn onSignedIn={onSignedIn} />
        <p className="mt-6 text-xs text-slate-400">
          Private to the bot's owner. You stay signed in for 60 days.
        </p>
      </div>
    </div>
  );
}
