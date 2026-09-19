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

  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.CONTACT_EMAIL_TO;
  const sender = process.env.EMAIL_FROM || "Releeve <no-reply@releeve.xyz>";

  if (!apiKey || !recipient) {
    console.error("Contact form delivery is not configured. Set RESEND_API_KEY and CONTACT_EMAIL_TO.");
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
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        reply_to: email,
        subject: `[Releeve website] ${subject}`,
        text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("Contact form delivery failed", response.status, detail.slice(0, 500));
      return NextResponse.json({ error: "We could not send your message. Please try again." }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (cause) {
    console.error("Contact form delivery failed", cause);
    return NextResponse.json({ error: "We could not send your message. Please try again." }, { status: 502 });
  }
}
