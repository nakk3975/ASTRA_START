import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
const App = lazy(() => import("./App"));
const Pilot = lazy(() => import("./Pilot"));
const standalone = import.meta.env.MODE === "review";
createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p role="status">작업장을 불러오는 중…</p>}>
    {standalone || location.pathname.replace(/\/$/, "") === "/asset-review" ? (
      <Pilot standalone={standalone} />
    ) : (
      <App />
    )}
  </Suspense>,
);
