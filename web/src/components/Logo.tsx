// The app's mark: a pine tile with the N, and the marigold dot that marks
// "now" elsewhere in the app.
export function Logo({ size }: { size: number }) {
  return (
    <img
      src="/favicon.svg"
      alt=""
      width={size}
      height={size}
      className="block shrink-0"
    />
  );
}
