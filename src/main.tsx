import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdateNotice } from "./components/UpdateNotice";

import App from "./App";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <UpdateNotice />
    </ErrorBoundary>
  </StrictMode>,
);
