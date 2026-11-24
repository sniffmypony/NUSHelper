import { lazy, Suspense } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

const LiquidLogo = lazy(() => import("./LiquidLogo"));

// The app's mark. `liquid` turns the N into moving chrome (sign-in screen);
// it stays still with reduced motion, and falls back to the plain mark
// while loading or where WebGL isn't available.
export function Logo({
  size,
  liquid = false,
}: {
  size: number;
  liquid?: boolean;
}) {
  const still = (
    <img
      src="/favicon.svg"
      alt=""
      width={size}
      height={size}
      className="block"
    />
  );
  if (
    !liquid ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return still;
  }
  return (
    // The orange tile, its gradient mixed in OKLCH (no grey middle), with the
    // chrome N on top. Corner radius as in the mark: 8/32 of its size.
    <div
      className="relative overflow-hidden shadow-card"
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        background:
          "linear-gradient(in oklch 135deg, oklch(0.8 0.16 65), oklch(0.66 0.19 42))",
      }}
    >
      <ErrorBoundary fallback={still}>
        <Suspense fallback={still}>
          <LiquidLogo size={size} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
