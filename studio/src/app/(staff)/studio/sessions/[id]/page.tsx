import SessionOverview from "@/components/session/SessionOverview";

// Auth is enforced by middleware (must be signed in to reach /studio/*); the
// exact back-link destination depends on the viewer's role, which
// SessionOverview resolves itself via a reliable browser-side check.
export default async function DesignerSessionPage({
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
      defaultBackUrl="/studio/designer"
      defaultBackLabel="Dashboard"
    />
  );
}
