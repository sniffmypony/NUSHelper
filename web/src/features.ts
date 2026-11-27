import { createContext, useContext } from "react";

// Which optional features are set up (from /api/web/me), so a page can say
// a feature is off instead of failing. Until known, everything counts as on.
export interface Features {
  ai: boolean;
  calendar: boolean;
  canvas: boolean;
}

export const ALL_ON: Features = { ai: true, calendar: true, canvas: true };

export const FeaturesContext = createContext<Features>(ALL_ON);

export function useFeatures(): Features {
  return useContext(FeaturesContext);
}
