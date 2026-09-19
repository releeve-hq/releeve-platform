import { NextResponse } from "next/server";

export const runtime = "nodejs";

const limits = {
  firstName: 120,
  lastName: 120,
  email: 320,
  subject: 120,
  message: 4000,
} as const;

type ContactField = keyof typeof limits;

function readField(body: Record<string, unknown>, field: ContactField) {
  const value = body[field];
  return typeof value === "string" ? value.trim().slice(0, limits[field]) : "";
}

function addressFrom(value: string) {
  const bracketed = value.match(/<([^>]+)>/)?.[1];
  const address = (bracketed || value).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : "";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] || character);
}

async function deliverEmail({ recipient, sender, replyTo, subject, text }: { recipient: string; sender: string; replyTo: string; subject: string; text: string }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender, to: [recipient], reply_to: replyTo, subject, text }),
    });
    return { ok: response.ok, provider: "resend", status: response.status, detail: await response.text() };
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN;
  if (accountId && apiToken) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to: recipient,
        subject,
        text,
        html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
      }),
    });
    const detail = await response.text();
    let delivered = response.ok;
    try {
      const payload = JSON.parse(detail) as { success?: boolean; result?: { delivered?: unknown[] } };
      delivered = response.ok && payload.success === true && Boolean(payload.result?.delivered?.length);
    } catch {
      delivered = false;
    }
    return { ok: delivered, provider: "cloudflare", status: response.status, detail };
  }

  return null;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Please complete the form and try again." }, { status: 400 });
  }

  if (typeof body.company === "string" && body.company.trim()) {
    return NextResponse.json({ ok: true });
  }

  const firstName = readField(body, "firstName");
  const lastName = readField(body, "lastName");
  const email = readField(body, "email");
  const subject = readField(body, "subject");
  const message = readField(body, "message");
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!firstName || !lastName || !validEmail || !subject || !message) {
    return NextResponse.json({ error: "Please complete every field with a valid email address." }, { status: 400 });
  }

  const sender = process.env.EMAIL_FROM || "Releeve <no-reply@releeve.xyz>";
  const recipient = process.env.CONTACT_EMAIL_TO || addressFrom(sender);

  if (!recipient) {
    console.error("Contact form recipient is not configured. Set CONTACT_EMAIL_TO or a valid EMAIL_FROM.");
    return NextResponse.json({ error: "Messaging is temporarily unavailable. Please try again shortly." }, { status: 503 });
  }

  const text = [
    `Name: ${firstName} ${lastName}`,
    `Email: ${email}`,
    `Subject: ${subject}`,
    "",
    message,
  ].join("\n");

  try {
    const delivery = await deliverEmail({ recipient, sender, replyTo: email, subject: `[Releeve website] ${subject}`, text });
    if (!delivery) {
      console.error("Contact form delivery is not configured. Set RESEND_API_KEY or the Cloudflare email credentials.");
      return NextResponse.json({ error: "Messaging is temporarily unavailable. Please try again shortly." }, { status: 503 });
    }
    if (!delivery.ok) {
      console.error("Contact form delivery failed", delivery.provider, delivery.status, delivery.detail.slice(0, 500));
      return NextResponse.json({ error: "We could not send your message. Please try again." }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (cause) {
    console.error("Contact form delivery failed", cause);
    return NextResponse.json({ error: "We could not send your message. Please try again." }, { status: 502 });
  }
}
