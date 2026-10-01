"use client";

import { useEffect, useState, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import Button from "@/components/ui/Button";

const PAGE_SIZE = 20;
const POLL_MS = 4000;
const TERMINAL_STATUSES = new Set(["delivered", "read", "failed"]);

interface Customer { id: string; name: string; phone: string }
interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  components: Array<{ type: string; text?: string }>;
}
interface SendResultRow {
  customerId: string;
  name: string;
  phone: string;
  ok: boolean;
  wamid: string | null;
  error: string | null;
  status?: string;
}

function variableCount(template: Template): number {
  const body = template.components.find((c) => c.type === "BODY")?.text ?? "";
  return new Set(Array.from(body.matchAll(/{{\s*(\d+)\s*}}/g)).map((m) => m[1])).size;
}

export default function SendMessagePanel() {
  const supabase = createSupabaseBrowserClient();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [variables, setVariables] = useState<string[]>([]);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [results, setResults] = useState<SendResultRow[] | null>(null);

  const loadPage = useCallback(async (offset: number) => {
    const { data, count } = await supabase
      .from("customers")
      .select("id, name, phone", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    setTotalCount(count ?? 0);
    return data ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const rows = await loadPage(0);
      setCustomers(rows);
    })();
    (async () => {
      const res = await fetch("/api/whatsapp/templates");
      const body = await res.json();
      if (res.ok) setTemplates(body.templates.filter((t: Template) => t.status === "APPROVED"));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLoadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const rows = await loadPage(customers.length);
    setCustomers((prev) => [...prev, ...rows]);
    setLoadingMore(false);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const selectedTemplate = templates?.find((t) => t.name === templateName) ?? null;

  function handleSelectTemplate(name: string) {
    setTemplateName(name);
    const t = templates?.find((tpl) => tpl.name === name);
    setVariables(t ? Array.from({ length: variableCount(t) }, () => "") : []);
  }

  async function handleSend() {
    if (!selectedTemplate || selected.size === 0) return;
    setSending(true);
    setSendError("");
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerIds: Array.from(selected),
          templateName: selectedTemplate.name,
          language: selectedTemplate.language,
          variables,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Send failed");
      setResults(body.results);
      setSelected(new Set());
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  // Polls Meta's delivery status for the batch just sent -- Sent shows
  // immediately from the send response; Delivered/Read arrive a moment
  // later via the webhook, this just reflects that into the same list.
  // Re-runs on every `results` change (including the poll's own update), so
  // it naturally stops once every row has reached a terminal status.
  useEffect(() => {
    if (!results) return;
    const wamids = results.filter((r) => r.wamid).map((r) => r.wamid as string);
    if (wamids.length === 0) return;
    if (results.every((r) => !r.wamid || TERMINAL_STATUSES.has(r.status ?? ""))) return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/whatsapp/send/status?wamids=${wamids.join(",")}`);
      const body = await res.json();
      if (!res.ok) return;
      const byWamid = new Map(body.statuses.map((s: { wamid: string; status: string }) => [s.wamid, s.status]));
      setResults((prev) => prev?.map((r) => (r.wamid && byWamid.has(r.wamid) ? { ...r, status: byWamid.get(r.wamid) as string } : r)) ?? null);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [results]);

  if (results) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h2 className="font-cinzel text-lg font-black text-ink flex-1">Send Result</h2>
          <button
            onClick={() => setResults(null)}
            className="text-gold text-xs font-mono uppercase tracking-widest underline cursor-pointer"
          >
            Send another
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {results.map((r) => (
            <div key={r.customerId} className="bg-surface border border-cleo-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-ink font-semibold text-sm truncate">{r.name}</p>
                <p className="text-muted text-xs font-mono">{r.phone}</p>
              </div>
              {r.ok ? (
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full border bg-success/10 text-success border-success/30">
                  {r.status ?? "Sent"}
                </span>
              ) : (
                <span title={r.error ?? ""} className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full border bg-error/10 text-error border-error/30">
                  Failed
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-cinzel text-lg font-black text-ink">Send Message</h2>

      {templates !== null && templates.length === 0 && (
        <p className="text-muted text-sm">No approved templates yet — create one on the Templates tab and wait for Meta to approve it.</p>
      )}

      {templates && templates.length > 0 && (
        <div className="bg-surface border border-cleo-border rounded-xl p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Template
            <select
              value={templateName}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              className="bg-bg border border-cleo-border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-gold"
            >
              <option value="">Select a template…</option>
              {templates.map((t) => <option key={t.id} value={t.name}>{t.name} ({t.language})</option>)}
            </select>
          </label>
          {variables.map((v, i) => (
            <label key={i} className="flex flex-col gap-1 text-xs text-muted">
              {`{{${i + 1}}}`} value
              <input
                value={v}
                onChange={(e) => setVariables((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))}
                className="bg-bg border border-cleo-border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-gold"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <p className="text-ink text-sm font-semibold flex-1">Select customers</p>
        <span className="text-[10px] font-mono text-muted bg-surface border border-cleo-border px-2.5 py-1 rounded-full">
          {selected.size} selected
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {customers.map((c) => (
          <label key={c.id} className="bg-surface border border-cleo-border rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-gold/40 transition-colors">
            <input
              type="checkbox"
              checked={selected.has(c.id)}
              onChange={() => toggleSelected(c.id)}
              className="w-4 h-4 accent-gold cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <p className="text-ink font-semibold text-sm truncate">{c.name}</p>
              <p className="text-muted text-xs font-mono">{c.phone}</p>
            </div>
          </label>
        ))}
        {customers.length < totalCount && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="mt-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-gold hover:text-gold-light border border-cleo-border hover:border-gold/40 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load More"}
          </button>
        )}
      </div>

      {sendError && <p className="text-error text-sm">{sendError}</p>}

      <Button
        onClick={handleSend}
        loading={sending}
        disabled={!selectedTemplate || selected.size === 0 || variables.some((v) => !v.trim())}
        fullWidth
      >
        Send to {selected.size || ""} {selected.size === 1 ? "customer" : "customers"}
      </Button>
    </div>
  );
}
