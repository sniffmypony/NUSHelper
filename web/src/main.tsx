import "@fontsource-variable/inter";
import { LazyMotion, MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { startTheme } from "./theme";

startTheme();

const features = () =>
  import("./motion-features").then((module) => module.default);

// reducedMotion="user": with the system's reduced-motion setting, Motion
// drops movement and keeps fades (web/DESIGN.md §5).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <LazyMotion features={features} strict>
        <App />
      </LazyMotion>
    </MotionConfig>
  </StrictMode>,
);
