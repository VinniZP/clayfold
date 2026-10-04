import { StrictMode } from "react";
import * as stylex from "@stylexjs/stylex";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider, useRouteError } from "react-router";
import { AppRoot } from "./components/AppRoot";
import { useHeader } from "./components/header";
import { Layout } from "./components/Layout";
import { Empty, ErrorBox } from "./components/ui";
import { btn, card } from "./theme/ui";
import { AuditPage } from "./pages/Audit";
import { GlossaryPage } from "./pages/Glossary";
import { Home } from "./pages/Home";
import { LessonPage } from "./pages/Lesson";
import { MeerkatPage } from "./pages/Meerkat";
import { MemoryIndex, MemoryPage } from "./pages/Memory";
import { MistakesPage } from "./pages/Mistakes";
import { ReviewPage } from "./pages/Review";
import { SettingsPage } from "./pages/Settings";
import { TopicPage, TopicsPage } from "./pages/Topic";
import "overlayscrollbars/overlayscrollbars.css";
import "./styles/global.css";
import { initGame } from "./lib/game";
import { initLang, t, useLang } from "./lib/i18n";
import { initPageScrollbars } from "./lib/overlayScroll";

const s = stylex.create({
  errorPage: { maxWidth: 720, marginInline: "auto", paddingTop: 80 },
});

function NotFound() {
  useLang();
  useHeader({ title: t("notFound.title") });
  return (
    <section {...stylex.props(card.base)}>
      <Empty
        title={t("notFound.empty")}
        art="search-magnifier"
        action={
          <Link to="/" {...stylex.props(btn.base, btn.primary)}>
            {t("notFound.home")}
          </Link>
        }
      />
    </section>
  );
}

function RouteError() {
  useLang();
  const error = useRouteError();
  return (
    <AppRoot>
      <section {...stylex.props(card.base, s.errorPage)}>
        <ErrorBox error={error} title={t("routeError.title")} onRetry={() => window.location.reload()} />
      </section>
    </AppRoot>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/topics", element: <TopicsPage /> },
      { path: "/topics/:topicId", element: <TopicPage /> },
      { path: "/lessons/:lessonId", element: <LessonPage /> },
      { path: "/review", element: <ReviewPage /> },
      { path: "/mistakes", element: <MistakesPage /> },
      { path: "/memory", element: <MemoryIndex /> },
      { path: "/memory/:topicId", element: <MemoryPage /> },
      { path: "/audit", element: <AuditPage /> },
      { path: "/glossary", element: <GlossaryPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/meerkat", element: <MeerkatPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

async function start() {
  if (__MOCK__) {
    const { installMock } = await import("./mock/install");
    installMock();
  }
  await Promise.all([initLang(), initGame()]);
  initPageScrollbars();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

void start();
