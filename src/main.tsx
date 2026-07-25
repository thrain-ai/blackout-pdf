import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { installBrowserPlatform } from "./platform/browser.ts";
import "./styles.css";

// Must run before any PDF is loaded or exported — the engine itself is
// environment-agnostic and refuses to guess which one it is in.
installBrowserPlatform();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
