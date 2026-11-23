export function SoonPage({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
      <h1 className="text-lg font-semibold">{label}</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Coming in the next phases. Settings are ready now.
      </p>
    </div>
  );
}
