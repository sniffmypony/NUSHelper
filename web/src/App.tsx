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

  const refresh = useCallback(() => {
    api<Me>("me")
      .then(setMe)
      .catch(() =>
        setMe({ authenticated: false, fresh: false, expiresAt: null }),
      );
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (me?.authenticated && (path === "/" || path === ""))
      navigate("/settings");
  }, [me, path]);

  if (!me) return null;
  if (!me.authenticated) return <LoginPage onSignedIn={refresh} />;

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
