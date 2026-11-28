import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Logo } from "../components/Logo";
import { Shake } from "../components/motion";
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
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {botUsername ? (
        <TelegramLogin botUsername={botUsername} onAuth={onAuth} />
      ) : (
        !error && <p className="text-sm text-faint">Loading…</p>
      )}
      {error && (
        <p role="alert" className="animate-settle text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function LoginPage({
  onSignedIn,
  linkError,
}: {
  onSignedIn: () => void;
  linkError?: string | null;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm animate-settle rounded-3xl border border-line bg-surface p-8 shadow-card">
        <div className="mx-auto mb-6 w-fit">
          <Logo size={64} liquid />
        </div>
        {linkError && (
          // The refused link shakes the message, like a head shake.
          <Shake trigger={1}>
            <p
              role="alert"
              className="mb-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              {linkError}
            </p>
          </Shake>
        )}
        <SignIn onSignedIn={onSignedIn} />
        <div className="my-6 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>
        <p className="text-sm text-muted">
          Send{" "}
          <code className="rounded bg-sunken px-1.5 py-0.5 text-ink">/web</code>{" "}
          to your bot and tap the link it sends. It works once, for 10 minutes.
        </p>
        <p className="mt-6 text-xs text-faint">
          Private to the bot's owner. You stay signed in for 60 days.
        </p>
        <p className="mt-2 text-xs text-faint">
          <a className="underline hover:text-muted" href="/privacy">
            Privacy policy
          </a>
        </p>
        <p className="mt-2 text-xs text-faint">
          First time? The button needs your bot to know this site: in @BotFather
          send /setdomain and then {window.location.host}.
        </p>
      </div>
    </div>
  );
}
