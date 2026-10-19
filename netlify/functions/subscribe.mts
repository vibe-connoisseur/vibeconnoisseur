// Receives newsletter sign-ups from the pop-up on Where's The Vibe and
// forwards them to the same Apps Script web app used for Stripe payments.
// The script adds each new email to the private "Where's The Vibe Newsletter
// Subscribers" spreadsheet and skips addresses already on the list.
//
// Uses the existing environment variables, so nothing new to set in Netlify:
//   SHEETS_WEBHOOK_URL      the Apps Script web app URL
//   SHEETS_WEBHOOK_SECRET   shared secret, also saved in the Apps Script

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function cleanEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : "";
}

export default async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  let body: { email?: string; website?: string; source?: string; page?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send your email address to sign up." }, { status: 400 });
  }

  // Hidden "website" field: people never see it, bots fill it in. Pretend it worked.
  if (body.website) return Response.json({ ok: true });

  const email = cleanEmail(body.email);
  if (!email) return Response.json({ error: "That email address does not look right." }, { status: 400 });

  const sheetsUrl = Netlify.env.get("SHEETS_WEBHOOK_URL") || "";
  const sheetsSecret = Netlify.env.get("SHEETS_WEBHOOK_SECRET") || "";
  if (!sheetsUrl || !sheetsSecret) {
    console.error("SHEETS_WEBHOOK_URL or SHEETS_WEBHOOK_SECRET is not set");
    return Response.json({ error: "Sign-ups are paused right now. Try again later." }, { status: 500 });
  }

  try {
    const response = await fetch(sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: sheetsSecret,
        action: "subscribe",
        subscriber: {
          email,
          source: String(body.source || "popup").slice(0, 40),
          page: String(body.page || "").slice(0, 200),
        },
      }),
    });

    const text = await response.text();
    let result: { ok?: boolean; status?: string; error?: string } = {};
    try {
      result = JSON.parse(text);
    } catch {
      result = { ok: false, error: "Apps Script did not return JSON" };
    }

    if (!response.ok || !result.ok) {
      console.error("Newsletter sign-up failed", response.status, result.error || text.slice(0, 200));
      return Response.json({ error: "Could not save your email. Try again in a moment." }, { status: 502 });
    }

    return Response.json({ ok: true, status: result.status });
  } catch (error) {
    console.error("Newsletter sign-up failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Could not save your email. Try again in a moment." }, { status: 502 });
  }
};

export const config = {
  path: "/api/subscribe",
};
