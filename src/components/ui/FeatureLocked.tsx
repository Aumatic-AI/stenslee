"use client";

interface FeatureLockedProps {
  title?: string;
  message?: string;
  className?: string;
  // Optional nav buttons -- `onBack` is almost always `() => router.back()`
  // from the call site, since that's correct no matter which page/role
  // reached this locked state. `secondary` is for a specific, real
  // destination (e.g. Settings) when one makes sense for that page.
  onBack?: () => void;
  secondary?: { label: string; onClick: () => void };
}

// Shared "not available on your plan" state for a WHOLE page or a WHOLE
// mode/tab's content -- not for a single disabled button or toggle (those
// stay as their own small inline lock + tooltip, no need for this).
export function FeatureLocked({
  title = "Not available on your plan",
  message,
  className = "",
  onBack,
  secondary,
}: FeatureLockedProps) {
  return (
    <div
      className={`rounded-2xl border border-gold/20 bg-surface/60 px-6 py-10 sm:py-14 flex flex-col items-center gap-4 text-center ${className}`}
    >
      <div className="w-14 h-14 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center">
        <svg className="w-7 h-7 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </div>

      <div className="flex flex-col gap-1.5 max-w-sm">
        <p className="font-cinzel text-base sm:text-lg font-black text-ink uppercase tracking-wide">{title}</p>
        {message && <p className="text-muted text-sm leading-relaxed">{message}</p>}
      </div>

      {(onBack || secondary) && (
        <div className="flex items-center gap-3 mt-1">
          {onBack && (
            <button
              onClick={onBack}
              className="bg-gold text-bg font-cinzel font-bold text-xs tracking-[0.08em] uppercase px-5 py-2.5 rounded-xl border border-gold hover:bg-gold-light transition-colors cursor-pointer"
            >
              Go Back
            </button>
          )}
          {secondary && (
            <button
              onClick={secondary.onClick}
              className="bg-transparent text-muted font-cinzel font-bold text-xs tracking-[0.08em] uppercase px-5 py-2.5 rounded-xl border border-cleo-border hover:border-gold/40 hover:text-ink transition-colors cursor-pointer"
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}

      <p className="text-muted/60 text-[11px] mt-1">Ask your studio admin to upgrade your plan for access.</p>
    </div>
  );
}
