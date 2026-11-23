import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { NAV, Shell } from "./components/Shell";
import { navigate, usePath } from "./navigation";
import { LoginPage } from "./pages/Login";
import { SettingsPage } from "./pages/Settings";
import { SoonPage } from "./pages/Soon";

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api<Me>("me")
      .then(setMe)
      .catch(() =>
        setMe({ authenticated: false, fresh: false, expiresAt: null }),
      );
  }, []);

  useEffect(refresh, [refresh]);

  // A sign-in link from the bot's /web command: /login#token=...
  // The token is removed from the address bar before it is used.
  useEffect(() => {
    if (path !== "/login") return;
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    window.history.replaceState(null, "", "/login");
    if (!token) return;
    api("auth/link", { method: "POST", body: { token } })
      .then(() => {
        navigate("/settings");
        refresh();
      })
      .catch((failure: Error) => setLinkError(failure.message));
  }, [path, refresh]);

  useEffect(() => {
    if (me?.authenticated && ["/", "", "/login"].includes(path)) {
      navigate("/settings");
    }
  }, [me, path]);

  if (!me) return null;
  if (!me.authenticated) {
    return <LoginPage onSignedIn={refresh} linkError={linkError} />;
  }

  const page = NAV.find((item) => path.startsWith(item.path));
  return (
    <Shell path={path}>
      {page?.path === "/settings" || !page ? (
        <SettingsPage me={me} onSessionChange={refresh} />
      ) : (
        <SoonPage label={page.label} />
      )}
    </Shell>
  );
}
