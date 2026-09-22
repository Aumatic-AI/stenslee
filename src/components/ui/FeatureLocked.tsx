interface FeatureLockedProps {
  title?: string;
  message?: string;
  className?: string;
}

// Shared "not available on your plan" state -- matches the dark/gold theme
// (see AGENTS.md's Styling section) so every gated feature renders the same
// locked state instead of each one inventing its own.
export function FeatureLocked({
  title = "Not available on your plan",
  message,
  className = "",
}: FeatureLockedProps) {
  return (
    <div
      className={`rounded-xl border border-gold/20 bg-surface/40 px-5 py-6 flex flex-col items-center gap-2 text-center ${className}`}
    >
      <svg className="w-6 h-6 text-gold/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
      <p className="font-cinzel text-sm font-bold tracking-wide text-gold uppercase">{title}</p>
      {message && <p className="text-muted text-xs max-w-xs">{message}</p>}
    </div>
  );
}
