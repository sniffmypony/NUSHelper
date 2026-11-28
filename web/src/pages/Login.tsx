import { Clock, Lock, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ICON } from "../components/icons";
import { Logo } from "../components/Logo";
import { Accordion, Shake } from "../components/motion";
import { Skeleton } from "../components/page";
import { TelegramLogin } from "../components/TelegramLogin";
import { Notice } from "../components/ui";

// Telegram Login for the bot's owner. Also used in Settings to confirm it's
// you before keys change.
export function SignIn({
  onSignedIn,
  title = "Sign in with Telegram",
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
    <div className="flex flex-col items-center gap-3 text-center">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      </div>
      {botUsername ? (
        <TelegramLogin botUsername={botUsername} onAuth={onAuth} />
      ) : (
        !error && (
          <div aria-busy="true" className="flex min-h-12 items-center">
            <Skeleton className="h-10 w-56 rounded-lg" />
          </div>
        )
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

const STEPS = [
  <>
    Send{" "}
    <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[13px] text-ink">
      /web
    </code>{" "}
    to your bot.
  </>,
  <>Tap Get a sign-in link.</>,
  <>Open the link. It works once, for 20 minutes.</>,
];

export function LoginPage({
  onSignedIn,
  linkError,
}: {
  onSignedIn: () => void;
  linkError?: string | null;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <main className="w-full max-w-sm animate-settle">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={36} />
          <span className="text-lg font-semibold tracking-tight">
            NUSHelper
          </span>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 sm:p-7">
          {linkError && (
            // The refused link shakes the message, like a head shake.
            <Shake trigger={1} className="mb-5">
              <div
                role="alert"
                className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm"
              >
                <p className="font-medium text-danger">{linkError}</p>
                <p className="mt-1 text-muted">
                  Links work once and expire after 20 minutes. Send /web to your
                  bot for a new one.
                </p>
              </div>
            </Shake>
          )}
          <SignIn onSignedIn={onSignedIn} />

          <div className="my-6 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" />
            or use a link from the bot
            <span className="h-px flex-1 bg-line" />
          </div>

          <ol className="space-y-2.5 text-sm text-ink">
            {STEPS.map((step, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="tnum grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold text-muted ring-1 ring-line ring-inset">
                  {index + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <ul className="mt-5 space-y-2 px-1 text-[13px] text-muted">
          <li className="flex items-start gap-2">
            <Lock {...ICON} size={14} className="mt-0.5 shrink-0" />
            Only the Telegram account that owns this bot can sign in.
          </li>
          <li className="flex items-start gap-2">
            <Clock {...ICON} size={14} className="mt-0.5 shrink-0" />
            You stay signed in on this browser for 60 days.
          </li>
        </ul>

        <Accordion
          open={false}
          className="mt-3 px-1"
          summaryClassName="text-[13px] font-medium text-muted hover:text-ink"
          title="The Telegram button doesn't appear"
        >
          <p className="flex items-start gap-2 pt-1 pb-2 pl-5 text-[13px] text-muted">
            <Send {...ICON} size={14} className="mt-0.5 shrink-0" />
            <span>
              The button needs your bot to know this site. In @BotFather send
              /setdomain, pick your bot, then send{" "}
              <span className="font-mono text-ink">{window.location.host}</span>
              .
            </span>
          </p>
        </Accordion>

        <p className="mt-4 px-1 text-[13px]">
          <a
            className="text-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
            href="/privacy"
          >
            Privacy policy
          </a>
        </p>
      </main>
    </div>
  );
}
