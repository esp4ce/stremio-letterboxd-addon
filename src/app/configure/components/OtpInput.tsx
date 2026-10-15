"use client";

import { useRef } from "react";

/**
 * Six single-digit fields. Typing moves forward, Backspace moves back, a pasted
 * code fills every field, and `onComplete` fires once the sixth digit is in.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  label = "Verification code",
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, 6);
    onChange(clean);
    if (clean.length === 6) onComplete(clean);
  };

  return (
    <div role="group" aria-label={`${label}, 6 digits`} className="grid grid-cols-6 gap-2">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          spellCheck={false}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
          autoFocus={index === 0}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "").slice(-1);
            const next = value.slice(0, index) + typed + value.slice(index + 1);
            commit(next);
            if (typed) refs.current[index + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digit && index > 0) {
              refs.current[index - 1]?.focus();
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            if (!pasted) return;
            e.preventDefault();
            commit(pasted);
            refs.current[Math.min(pasted.length, 5)]?.focus();
          }}
          className="h-12 w-full min-w-0 rounded-control border border-control bg-field text-center font-mono text-lg font-medium text-foreground focus:border-foreground focus:outline-none"
        />
      ))}
    </div>
  );
}
