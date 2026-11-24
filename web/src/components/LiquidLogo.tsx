import { LiquidMetal } from "@paper-design/shaders-react";

// The "N" in liquid chrome (Paper Shaders), for the sign-in screen only.
// Loaded on its own (see Logo.tsx), so no other page carries WebGL code.
export default function LiquidLogo({ size }: { size: number }) {
  return (
    <LiquidMetal
      image="/logo-n.svg"
      width={size}
      height={size}
      colorBack="#00000000"
      colorTint="#ffffff"
      shape="none"
      repetition={2}
      softness={0.1}
      shiftRed={0.3}
      shiftBlue={0.3}
      distortion={0.07}
      contour={0.4}
      angle={70}
      speed={0.6}
      scale={0.9}
      fit="contain"
    />
  );
}
