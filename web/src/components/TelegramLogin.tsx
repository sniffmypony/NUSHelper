import { useEffect, useRef } from "react";

// Telegram's own sign-in button (core.telegram.org/widgets/login). It only
// works on the domain set for the bot with @BotFather's /setdomain.

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

export function TelegramLogin({
  botUsername,
  onAuth,
}: {
  botUsername: string;
  onAuth: (user: Record<string, unknown>) => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.onTelegramAuth = onAuth;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "10");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    const target = container.current;
    target?.replaceChildren(script);
    return () => {
      target?.replaceChildren();
      delete window.onTelegramAuth;
    };
  }, [botUsername, onAuth]);

  return <div ref={container} className="flex min-h-12 justify-center" />;
}
