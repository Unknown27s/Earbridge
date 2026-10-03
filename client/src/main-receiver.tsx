import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Receiver from "./Receiver";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Receiver />
  </StrictMode>,
);
