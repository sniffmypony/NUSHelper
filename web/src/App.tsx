import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { NAV, Shell } from "./components/Shell";
import { ALL_ON, FeaturesContext } from "./features";
import { navigate, usePath } from "./navigation";
import { CalendarPage } from "./pages/Calendar";
import { DeadlinesPage } from "./pages/Deadlines";
import { LoginPage } from "./pages/Login";
import { SettingsPage } from "./pages/Settings";
import { SpendingPage } from "./pages/Spending";
import { TasksPage } from "./pages/Tasks";
import { TimetablePage } from "./pages/Timetable";
import { TodayPage } from "./pages/Today";

// Chat brings Markdown and maths rendering; it's loaded only when opened.
const ChatPage = lazy(() =>
  import("./pages/Chat").then((module) => ({ default: module.ChatPage })),
);

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

  // Again on each page change, so a feature set up in Settings shows as on.
  useEffect(refresh, [refresh, path]);

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
        navigate("/today");
        refresh();
      })
      .catch((failure: Error) => setLinkError(failure.message));
  }, [path, refresh]);

  useEffect(() => {
    if (me?.authenticated && ["/", "", "/login"].includes(path)) {
      navigate("/today");
    }
  }, [me, path]);

  if (!me) return null;
  if (!me.authenticated) {
    return <LoginPage onSignedIn={refresh} linkError={linkError} />;
  }

  const page = NAV.find((item) => path.startsWith(item.path));
  return (
    <FeaturesContext.Provider value={me.features ?? ALL_ON}>
      <Shell path={path}>
        {page?.path === "/today" ? (
          <TodayPage />
        ) : page?.path === "/tasks" ? (
          <TasksPage />
        ) : page?.path === "/spending" ? (
          <SpendingPage />
        ) : page?.path === "/timetable" ? (
          <TimetablePage />
        ) : page?.path === "/deadlines" ? (
          <DeadlinesPage />
        ) : page?.path === "/calendar" ? (
          <CalendarPage />
        ) : page?.path === "/chat" ? (
          <Suspense fallback={<p className="text-sm text-faint">Loading…</p>}>
            <ChatPage path={path} />
          </Suspense>
        ) : page?.path === "/settings" ? (
          <SettingsPage me={me} onSessionChange={refresh} />
        ) : (
          <TodayPage />
        )}
      </Shell>
    </FeaturesContext.Provider>
  );
}
