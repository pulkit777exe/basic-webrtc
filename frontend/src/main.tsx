import "./instrument";

import { reactErrorHandler } from "@sentry/react";
import { createRoot } from "react-dom/client";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import "./index.css";
import App from "./App.tsx";

gsap.registerPlugin(Flip);

createRoot(document.getElementById("root")!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(<App />);
