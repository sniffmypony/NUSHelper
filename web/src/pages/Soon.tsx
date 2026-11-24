export function SoonPage({ label }: { label: string }) {
  return (
    <div className="animate-settle rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">{label}</h1>
      <p className="mt-2 text-sm text-muted">
        Coming in the next phases. Settings are ready now.
      </p>
    </div>
  );
}
