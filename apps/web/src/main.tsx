import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Pilot from "./Pilot";
createRoot(document.getElementById("root")!).render(location.pathname === "/asset-review" ? <Pilot /> : <App />);
