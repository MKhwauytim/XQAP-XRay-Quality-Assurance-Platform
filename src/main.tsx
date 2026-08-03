import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WorkspaceProvider } from "./data/workspace/WorkspaceProvider";
import { ARABIC_FONT_FACE_CSS } from "./branding/fonts";
import { SOMAR_SANS_APP_FONT_FACE_CSS } from "./branding/somarFonts";

import "./index.css";
import "./styles/primitives.css";

// Embed the IBM Plex Sans Arabic @font-face (base64 data-URI woff2) into the app
// document from the SAME single source the generated reports use, so the UI and
// its reports render Arabic identically and fully offline.
const fontStyle = document.createElement("style");
fontStyle.setAttribute("data-arabic-font", "");
fontStyle.textContent = ARABIC_FONT_FACE_CSS;
document.head.appendChild(fontStyle);

// Embed the Somar Sans brand font the same way, from the same shared source
// the report/deck builders use (§Q) -- previously index.css's own static
// @font-face rules caused Vite to inline a second, independent copy of the
// same 4 files into the built bundle.
const somarFontStyle = document.createElement("style");
somarFontStyle.setAttribute("data-somar-font", "");
somarFontStyle.textContent = SOMAR_SANS_APP_FONT_FACE_CSS;
document.head.appendChild(somarFontStyle);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </ErrorBoundary>
  </StrictMode>
);
