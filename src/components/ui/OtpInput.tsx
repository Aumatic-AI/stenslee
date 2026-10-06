"use client";

import { useEffect, useRef } from "react";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

// Six separate boxes instead of one text field. Semi-controlled: each box
// owns its own DOM value while the user is typing (simplest way to support
// per-box focus management + paste-splitting without index-gap bugs), and
// the composed code is reported upward via onChange. The parent can reset
// it by setting `value` back to "" (e.g. on resend, or changing step).
export default function OtpInput({ value, onChange, length = 6, autoFocus, disabled }: OtpInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (value === "") {
      inputRefs.current.forEach((el) => { if (el) el.value = ""; });
      if (autoFocus) inputRefs.current[0]?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emitChange() {
    onChange(inputRefs.current.map((el) => el?.value ?? "").join(""));
  }

  // Fills boxes starting at index 0 regardless of which box triggered it --
  // a paste or an OS/keyboard OTP autofill represents the whole code, not an
  // insert at the focused position.
  function distribute(digits: string) {
    const chars = digits.replace(/\D/g, "").slice(0, length).split("");
    chars.forEach((ch, i) => { const el = inputRefs.current[i]; if (el) el.value = ch; });
    emitChange();
    inputRefs.current[Math.min(chars.length, length - 1)]?.focus();
  }

  function handleInput(index: number, raw: string) {
    if (raw.length > 1) { distribute(raw); return; } // mobile OTP autofill can drop the whole code into one box
    const digit = raw.replace(/\D/g, "");
    const el = inputRefs.current[index];
    if (el) el.value = digit;
    if (digit && index < length - 1) inputRefs.current[index + 1]?.focus();
    emitChange();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !inputRefs.current[index]?.value && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.replace(/\D/g, "")) return;
    e.preventDefault();
    distribute(pasted);
  }

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={length} // intentionally not 1 -- lets a full-code autofill land in one box; handleInput re-splits it
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className="w-11 h-13 sm:w-12 sm:h-14 text-center bg-surface border border-cleo-border rounded-xl text-ink text-lg font-mono focus:outline-none focus:border-gold transition-colors disabled:opacity-50"
        />
      ))}
    </div>
  );
}
