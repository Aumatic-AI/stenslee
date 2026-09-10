import SessionOverview from "@/components/session/SessionOverview";

// Auth + admin-only access is enforced by middleware (designers are
// redirected away from /studio/admin/* at the edge); the back-link
// destination is resolved by SessionOverview via a browser-side check.
export default async function AdminSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;

  return (
    <SessionOverview
      sessionId={id}
      from={from}
      defaultBackUrl="/studio/admin"
      defaultBackLabel="Admin"
    />
  );
}
