import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { Database } from "@/types/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type OutboxItem =
  Database["public"]["Functions"]["claim_organization_invitation_email_outbox"]["Returns"][number];

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function invitationRoleLabel(role: OutboxItem["role"]): string {
  return role.toLowerCase().replaceAll("_", " ");
}

function getInvitationUrl(token: string): string {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("APP_BASE_URL_MISSING");

  const url = new URL("/auth/accept-invitation", baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function readProviderError(payload: unknown, status: number): string {
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return `RESEND_${status}: ${message.trim().slice(0, 400)}`;
    }
  }
  return `RESEND_HTTP_${status}`;
}

async function sendInvitationEmail(item: OutboxItem, apiKey: string, from: string) {
  const invitationUrl = getInvitationUrl(item.token);
  const organization = escapeHtml(item.organization_name);
  const role = escapeHtml(invitationRoleLabel(item.role));
  const link = escapeHtml(invitationUrl);

  const subject = `You're invited to join ${item.organization_name} on Voting Platform`;
  const text = [
    `You've been invited to join ${item.organization_name} as ${invitationRoleLabel(item.role)}.`,
    "",
    "Accept your invitation:",
    invitationUrl,
    "",
    "This invitation link expires in seven days and can only be accepted by a signed-in account with a verified matching email address.",
    "If you were not expecting this invitation, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f6f7f9;font-family:Arial,sans-serif;color:#17202a">
    <main style="max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
      <p style="margin:0 0 12px;color:#667085;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Voting Platform</p>
      <h1 style="margin:0 0 16px;font-size:24px">You're invited</h1>
      <p style="line-height:1.6">You've been invited to join <strong>${organization}</strong> as <strong>${role}</strong>.</p>
      <p style="margin:28px 0">
        <a href="${link}" style="display:inline-block;padding:12px 20px;background:#1d2939;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">Accept invitation</a>
      </p>
      <p style="font-size:13px;line-height:1.6;color:#667085">This link expires in seven days and can only be accepted by a signed-in account with a verified matching email address.</p>
      <p style="font-size:13px;line-height:1.6;color:#667085">If you were not expecting this invitation, you can ignore this email.</p>
    </main>
  </body>
</html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": item.outbox_id,
    },
    body: JSON.stringify({
      from,
      to: [item.email],
      subject,
      html,
      text,
      tags: [
        { name: "category", value: "organization_invitation" },
        { name: "outbox_id", value: item.outbox_id },
      ],
    }),
    cache: "no-store",
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readProviderError(payload, response.status));

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("id" in payload) ||
    typeof (payload as { id?: unknown }).id !== "string"
  ) {
    throw new Error("RESEND_RESPONSE_MISSING_EMAIL_ID");
  }

  return (payload as { id: string }).id;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Email delivery is not configured." }, { status: 503 });
  }

  const from = process.env.RESEND_FROM_EMAIL ?? "Voting Platform <notifications@poptraworld.digital>";

  try {
    const supabase = createSupabaseAdminClient();
    const { data: items, error: claimError } = await supabase.rpc(
      "claim_organization_invitation_email_outbox",
      { target_limit: 10 },
    );

    if (claimError) {
      console.error("Invitation outbox claim failed:", claimError.code);
      return NextResponse.json({ error: "Unable to claim invitation emails." }, { status: 500 });
    }

    let sent = 0;
    let retried = 0;
    let failed = 0;

    for (const item of (items ?? []) as OutboxItem[]) {
      try {
        const providerEmailId = await sendInvitationEmail(item, apiKey, from);
        const { error: completeError } = await supabase.rpc(
          "complete_organization_invitation_email_outbox",
          {
            target_outbox: item.outbox_id,
            target_lock_token: item.lock_token,
            target_provider_email_id: providerEmailId,
          },
        );

        if (completeError) throw new Error("OUTBOX_COMPLETION_FAILED");
        sent += 1;
      } catch (deliveryError) {
        const message = deliveryError instanceof Error ? deliveryError.message : "EMAIL_DELIVERY_FAILED";
        const { data: failureStatus, error: failureError } = await supabase.rpc(
          "fail_organization_invitation_email_outbox",
          {
            target_outbox: item.outbox_id,
            target_lock_token: item.lock_token,
            target_error: message.slice(0, 500),
          },
        );

        if (failureError) {
          console.error("Invitation outbox retry update failed:", failureError.code);
          continue;
        }

        if (failureStatus === "FAILED") failed += 1;
        else retried += 1;
      }
    }

    return NextResponse.json(
      { claimed: items?.length ?? 0, sent, retried, failed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Invitation email worker failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Invitation email processing failed." }, { status: 500 });
  }
}
