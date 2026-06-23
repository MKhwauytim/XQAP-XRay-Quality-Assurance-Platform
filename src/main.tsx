import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WorkspaceProvider } from "./data/workspace/WorkspaceProvider";

import "./index.css";

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
