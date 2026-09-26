"use client";

import { motion, AnimatePresence } from "framer-motion";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = "Delete", danger = true, loading = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !loading && onCancel()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface border border-cleo-border rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
          >
            <h2 className="font-cinzel text-lg font-black text-ink">{title}</h2>
            <p className="text-muted text-sm leading-relaxed">{message}</p>
            <div className="flex gap-3">
              <button
                type="button" onClick={onCancel} disabled={loading}
                className="flex-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-muted border border-cleo-border rounded-xl transition-colors cursor-pointer hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button" onClick={onConfirm} disabled={loading}
                className={`flex-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest rounded-xl transition-colors cursor-pointer disabled:opacity-60 ${
                  danger ? "text-white bg-error hover:bg-error/90" : "text-bg bg-gold hover:bg-gold-light"
                }`}
              >
                {loading ? "Working…" : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
