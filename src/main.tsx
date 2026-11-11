import React from "react";
import ReactDOM from "react-dom/client";
// Persian fonts (bundled by Vite, no network needed): rounded + bold Baloo Bhaijaan 2, Vazirmatn fills any missing glyph.
import "@fontsource/baloo-bhaijaan-2/arabic-400.css";
import "@fontsource/baloo-bhaijaan-2/arabic-500.css";
import "@fontsource/baloo-bhaijaan-2/arabic-600.css";
import "@fontsource/baloo-bhaijaan-2/arabic-700.css";
import "@fontsource/vazirmatn/arabic-400.css";
import "@fontsource/vazirmatn/arabic-700.css";
import "./index.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
