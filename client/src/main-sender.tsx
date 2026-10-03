import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Sender from "./Sender";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sender />
  </StrictMode>,
);
