"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface Template {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  components: Array<{ type: string; text?: string }>;
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: "bg-success/10 text-success border-success/30",
  PENDING: "bg-gold/10 text-gold border-gold/30",
  REJECTED: "bg-error/10 text-error border-error/30",
};

const LANGUAGES = [
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "hi", label: "Hindi" },
];

export default function TemplatesPanel() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("UTILITY");
  const [language, setLanguage] = useState("en_US");
  const [bodyText, setBodyText] = useState("");

  async function load() {
    setError("");
    const res = await fetch("/api/whatsapp/templates");
    const body = await res.json();
    if (!res.ok) { setError(body.error || "Failed to load templates"); return; }
    setTemplates(body.templates);
  }

  useEffect(() => {
    async function run() { await load(); }
    run();
  }, []);

  function resetForm() {
    setName(""); setCategory("UTILITY"); setLanguage("en_US"); setBodyText(""); setFormError("");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const res = await fetch("/api/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, language, bodyText }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to create template");
      setTemplates((prev) => (prev ? [body.template, ...prev] : [body.template]));
      resetForm();
      setCreating(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create template");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/whatsapp/templates/${deleteTarget.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to delete");
      setTemplates((prev) => prev?.filter((t) => t.id !== deleteTarget.id) ?? null);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete template");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <h2 className="font-cinzel text-lg font-black text-ink flex-1">Message Templates</h2>
        <button
          onClick={() => { setCreating((v) => !v); if (creating) resetForm(); }}
          className="bg-gold text-bg font-cinzel font-bold text-xs tracking-[0.08em] uppercase px-4 py-2.5 rounded-xl border border-gold hover:bg-gold-light transition-colors cursor-pointer"
        >
          {creating ? "Cancel" : "+ New Template"}
        </button>
      </div>

      {error && <p className="text-error text-sm">{error}</p>}

      {creating && (
        <form onSubmit={handleCreate} className="bg-surface border border-cleo-border rounded-xl p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Name
              <input
                value={name} onChange={(e) => setName(e.target.value)} required
                placeholder="appointment_reminder"
                className="bg-bg border border-cleo-border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-gold"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="bg-bg border border-cleo-border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-gold">
                <option value="UTILITY">Utility</option>
                <option value="MARKETING">Marketing</option>
                <option value="AUTHENTICATION">Authentication</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Language
              <select value={language} onChange={(e) => setLanguage(e.target.value)}
                className="bg-bg border border-cleo-border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-gold">
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Body text — use {"{{1}}"}, {"{{2}}"}, etc. for values filled in per customer when sending
            <textarea
              value={bodyText} onChange={(e) => setBodyText(e.target.value)} required rows={3}
              placeholder="Hi {{1}}, your appointment is confirmed for {{2}}."
              className="bg-bg border border-cleo-border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-gold resize-none"
            />
          </label>
          {formError && <p className="text-error text-xs">{formError}</p>}
          <p className="text-muted/70 text-[11px]">
            Submitted to Meta for review — new templates start as Pending and usually take a few minutes to a day to be Approved.
          </p>
          <Button type="submit" loading={saving} size="sm" className="self-start">Submit for Review</Button>
        </form>
      )}

      {templates === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-surface border border-cleo-border rounded-2xl p-8 text-center text-muted text-sm">
          No templates yet — create one above to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="bg-surface border border-cleo-border rounded-xl px-4 py-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-ink font-semibold text-sm truncate">{t.name}</p>
                <p className="text-muted text-xs font-mono">{t.category} · {t.language}</p>
              </div>
              <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full border ${STATUS_STYLES[t.status] ?? "border-cleo-border text-muted"}`}>
                {t.status}
              </span>
              <button
                onClick={() => setDeleteTarget(t)}
                className="text-muted hover:text-error transition-colors cursor-pointer p-1.5"
                aria-label={`Delete ${t.name}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete template?"
        message={`"${deleteTarget?.name}" will be removed from Meta and from every language variant of this template.`}
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
