"use client";

import { motion } from "framer-motion";
import type { ButtonHTMLAttributes } from "react";

type Variant = "gold" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

const variantClasses: Record<Variant, string> = {
  gold: "bg-gold text-bg font-bold hover:bg-gold-light active:bg-gold-dark border border-gold",
  outline: "bg-transparent text-gold border border-gold hover:bg-gold/10",
  ghost: "bg-transparent text-ink hover:bg-surface-2 border border-transparent",
  danger: "bg-error text-white border border-error hover:opacity-80",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-4 py-2 text-sm min-h-[36px]",
  md: "px-6 py-3 text-base min-h-[44px]",
  lg: "px-8 py-4 text-lg min-h-[52px]",
};

export default function Button({
  variant = "gold",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg font-cinzel tracking-wide",
        "transition-colors duration-200 cursor-pointer select-none",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
      disabled={disabled || loading}
      {...(props as object)}
    >
      {loading ? (
        <>
          <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
          <span>Loading…</span>
        </>
      ) : (
        children
      )}
    </motion.button>
  );
}
