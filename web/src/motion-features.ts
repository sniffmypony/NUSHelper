// Motion's layout, exit and drag features, loaded after the first render
// (LazyMotion in main.tsx) so they don't delay the first paint.
import { domMax } from "motion/react";
export default domMax;
