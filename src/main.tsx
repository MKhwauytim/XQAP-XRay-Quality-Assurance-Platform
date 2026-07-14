import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WorkspaceProvider } from "./data/workspace/WorkspaceProvider";
import { ARABIC_FONT_FACE_CSS } from "./branding/fonts";

import "./index.css";
import "./styles/primitives.css";

// Embed the IBM Plex Sans Arabic @font-face (base64 data-URI woff2) into the app
// document from the SAME single source the generated reports use, so the UI and
// its reports render Arabic identically and fully offline.
const fontStyle = document.createElement("style");
fontStyle.setAttribute("data-arabic-font", "");
fontStyle.textContent = ARABIC_FONT_FACE_CSS;
document.head.appendChild(fontStyle);

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
