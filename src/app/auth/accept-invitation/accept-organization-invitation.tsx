"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptOrganizationInvitation({ token }: { token: string }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json() as { organizationId?: string; error?: string };
      if (!response.ok || !payload.organizationId) {
        throw new Error(payload.error ?? "Unable to accept this invitation.");
      }
      router.replace(`/dashboard/organizations/${payload.organizationId}`);
      router.refresh();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to accept this invitation.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      {error && <p role="alert" style={{ color: "#b42318", marginBottom: 12 }}>{error}</p>}
      <button className="button" type="button" disabled={accepting} onClick={accept}>
        {accepting ? "Accepting invitation…" : "Accept invitation"}
      </button>
    </div>
  );
}
