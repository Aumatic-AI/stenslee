// In-memory generation job tracker. One active job per session at a time —
// starting a new one replaces the old (a session only ever waits on one
// batch at a time). Lets a long-running generation (KEI can take 1+ minute
// for 5 images) survive a page reload: the client doesn't hold a connection
// open for the whole thing, it polls this instead, and can resume polling
// after a reload since the job lives on the server, not in the response.
//
// Single-process, in-memory by design — fine at this app's scale. If this
// ever runs multi-instance, this needs to move to a shared store (DB/Redis).

export interface JobSlot {
  status: "pending" | "done" | "error";
  imageBase64?: string;
  reason?: string;
  code?: string;
}

export interface Job {
  iteration: number;
  // Carried on the job (not just in the caller's local state) so a client
  // that reloads mid-generation can still persist completed slots correctly
  // after resuming — it has no other way to recover these once reloaded.
  parentDesignIds: string[];
  userInstruction: string | null;
  slots: JobSlot[];
  createdAt: number;
}

const JOB_TTL_MS = 15 * 60 * 1000; // stale jobs (e.g. server restarted mid-run) stop blocking new ones

// Pinned to globalThis, not a plain module-level const: in Next.js dev mode,
// editing any file can make the dev server re-evaluate a route's module
// graph independently of other routes. Two route files that both import this
// module can otherwise end up with two different `jobs` Maps in memory at
// once — a job created via /api/generate-rework becomes invisible to
// /api/generation-status. Stashing the single instance on globalThis survives
// that re-evaluation. (Still single-process — a multi-instance/serverless
// deployment would need a real shared store like a DB table or Redis.)
declare global {
  var __cleopatraGenerationJobs: Map<string, Job> | undefined;
}
const jobs = globalThis.__cleopatraGenerationJobs ?? new Map<string, Job>();
globalThis.__cleopatraGenerationJobs = jobs;

export function startJob(
  sessionId: string,
  iteration: number,
  count: number,
  parentDesignIds: string[] = [],
  userInstruction: string | null = null
): Job {
  const job: Job = {
    iteration,
    parentDesignIds,
    userInstruction,
    slots: Array.from({ length: count }, () => ({ status: "pending" })),
    createdAt: Date.now(),
  };
  jobs.set(sessionId, job);
  return job;
}

export function getJob(sessionId: string): Job | undefined {
  const job = jobs.get(sessionId);
  if (job && Date.now() - job.createdAt > JOB_TTL_MS) {
    jobs.delete(sessionId);
    return undefined;
  }
  return job;
}

export function setSlot(sessionId: string, index: number, slot: JobSlot) {
  const job = jobs.get(sessionId);
  if (job && job.slots[index]) job.slots[index] = slot;
}

export function isJobDone(job: Job): boolean {
  return job.slots.every((s) => s.status !== "pending");
}
