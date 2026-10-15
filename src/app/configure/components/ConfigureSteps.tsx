const STEPS = ["Connect", "Choose", "Install"] as const;

/** Three-step progress shown on every configuration screen: connect, choose, install. */
export function ConfigureSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Setup progress" className="mx-auto w-full max-w-[1600px] px-4 pb-3 sm:px-6 lg:px-8">
      <ol className="grid grid-cols-3 gap-2">
        {STEPS.map((label, index) => {
          const step = index + 1;
          const done = step < current;
          const active = step === current;
          return (
            <li key={label} aria-current={active ? "step" : undefined} className="min-w-0">
              <div className={`h-1 rounded-full transition-colors ${done || active ? "bg-foreground" : "bg-line-strong"}`} />
              <p className={`mt-2 truncate text-[12px] ${active ? "text-foreground" : "text-dim"}`}>
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
