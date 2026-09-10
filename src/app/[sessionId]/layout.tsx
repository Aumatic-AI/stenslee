"use client";

import { use } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useAppStore } from "@/store/app-store";

const STEPS = [
  { label: "Design", path: "design" },
  { label: "Placement", path: "placement" },
];

export default function SessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const pathname = usePathname();
  const customerName = useAppStore((s) => s.customerName);

  const currentStep = STEPS.findIndex((s) => pathname.includes(s.path));

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="sticky top-0 z-30 bg-surface border-b border-cleo-border px-4 sm:px-6 py-3 flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-6 h-6 relative">
            <Image src="/cleopatra-logo.svg" alt="Cleopatra" fill className="object-contain" />
          </div>
          <span className="hidden sm:block font-cinzel text-[11px] font-bold tracking-[0.15em] text-muted uppercase">
            Cleopatra Ink
          </span>
        </Link>

        {/* Customer info */}
        {customerName && (
          <div className="flex items-center gap-2 bg-surface-2 border border-cleo-border rounded-lg px-3 py-1.5">
            <div className="w-5 h-5 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center">
              <span className="text-gold text-[9px] font-bold font-cinzel">
                {customerName.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="text-ink text-xs font-cinzel font-bold">{customerName}</span>
          </div>
        )}

        {/* Step progress */}
        <div className="ml-auto flex items-center gap-2">
          {STEPS.map((step, i) => {
            const isDone = i < currentStep;
            const isActive = i === currentStep;
            return (
              <div key={step.label} className="flex items-center gap-2">
                {i > 0 && (
                  <div className={`h-px w-6 sm:w-10 transition-colors ${isDone || isActive ? "bg-gold/50" : "bg-cleo-border"}`} />
                )}
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full transition-all ${isActive ? "bg-gold scale-125" : isDone ? "bg-gold/50" : "bg-cleo-border"}`} />
                  <span className={`hidden sm:block text-[10px] font-cinzel uppercase tracking-wider transition-colors ${isActive ? "text-gold" : isDone ? "text-gold/50" : "text-muted"}`}>
                    {step.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Session ID */}
        <span className="hidden md:block text-[10px] font-mono text-muted/50 ml-2">
          {sessionId}
        </span>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
