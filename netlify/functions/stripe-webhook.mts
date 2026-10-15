// Receives Stripe webhooks for completed Checkout payments (Payment Links),
// verifies they genuinely came from Stripe, and forwards the payment to the
// Google Apps Script attached to the TVC tracker sheet. That script logs every
// payment in a "Payments" tab and switches Vibe Approved to Yes on the matching
// event when a Vibe Approved product was bought.
//
// Environment variables (Netlify > Project configuration > Environment variables):
//   STRIPE_WEBHOOK_SECRET   whsec_... from the Stripe webhook endpoint (required)
//   STRIPE_SECRET_KEY       restricted key with read access to Checkout Sessions,
//                           Products and Prices (optional, but needed to spot
//                           Vibe Approved added as an extra on Options 1 to 4)
//   SHEETS_WEBHOOK_URL      the Apps Script web app URL (required)
//   SHEETS_WEBHOOK_SECRET   shared secret, also saved in the Apps Script (required)

const SIGNATURE_TOLERANCE_SECONDS = 300;
const VIBE_APPROVED_SKU = "x_vibe_approved";

type CustomField = { key: string; text?: { value: string | null } | null };

type CheckoutSession = {
  id: string;
  livemode: boolean;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  created: number;
  mode: string;
  metadata?: Record<string, string> | null;
  custom_fields?: CustomField[];
  customer_details?: { email?: string | null; name?: string | null; business_name?: string | null; phone?: string | null } | null;
  payment_link?: string | null;
};

type LineItem = {
  description?: string | null;
  quantity?: number | null;
  amount_total?: number | null;
  price?: { id: string; product?: string | { id: string; name?: string; metadata?: Record<string, string> } } | null;
};

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

// Implements Stripe's signature scheme: HMAC-SHA256 of "<timestamp>.<raw body>"
// with the endpoint secret, compared against every v1 signature in the header.
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`)));
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

function customField(session: CheckoutSession, key: string): string {
  return session.custom_fields?.find((field) => field.key === key)?.text?.value?.trim() || "";
}

async function fetchLineItems(sessionId: string, apiKey: string): Promise<LineItem[] | null> {
  const url = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/line_items?limit=100&expand[]=data.price.product`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) {
    console.error(`Stripe line item lookup returned ${response.status}`);
    return null;
  }
  const body = await response.json() as { data?: LineItem[] };
  return body.data || [];
}

function skuOf(item: LineItem): string {
  const product = item.price?.product;
  return typeof product === "object" && product ? product.metadata?.tvc_sku || "" : "";
}

export function buildSheetPayload(session: CheckoutSession, lineItems: LineItem[] | null) {
  const skus = lineItems ? lineItems.map(skuOf).filter(Boolean) : [];
  const metadataSku = session.metadata?.tvc_sku || "";
  const vibeApproved =
    session.metadata?.fulfil === "wtv_sheet" ||
    metadataSku === VIBE_APPROVED_SKU ||
    skus.includes(VIBE_APPROVED_SKU);

  return {
    sessionId: session.id,
    livemode: session.livemode,
    paidAt: new Date(session.created * 1000).toISOString(),
    amount: (session.amount_total || 0) / 100,
    currency: (session.currency || "gbp").toUpperCase(),
    customerName: session.customer_details?.business_name || session.customer_details?.name || "",
    customerEmail: session.customer_details?.email || "",
    customerPhone: session.customer_details?.phone || "",
    eventName: customField(session, "eventname"),
    eventDate: customField(session, "eventdate"),
    instagram: customField(session, "instahandle"),
    items: lineItems
      ? lineItems.map((item) => `${item.quantity || 1} x ${item.description || "Item"}`).join("; ")
      : metadataSku,
    skus: skus.length ? skus : (metadataSku ? [metadataSku] : []),
    vibeApproved,
    lineItemsChecked: lineItems !== null,
  };
}

export default async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const sheetsUrl = Netlify.env.get("SHEETS_WEBHOOK_URL") || "";
  const sheetsSecret = Netlify.env.get("SHEETS_WEBHOOK_SECRET") || "";
  const apiKey = Netlify.env.get("STRIPE_SECRET_KEY") || "";

  const rawBody = await request.text();
  const valid = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), webhookSecret);
  if (!valid) return Response.json({ error: "Invalid signature" }, { status: 400 });

  const event = JSON.parse(rawBody) as { id: string; type: string; data: { object: CheckoutSession } };

  // Acknowledge anything else so Stripe stops retrying it.
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return Response.json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  if (session.payment_status !== "paid") return Response.json({ received: true, ignored: "not paid yet" });

  if (!sheetsUrl || !sheetsSecret) {
    console.error("SHEETS_WEBHOOK_URL or SHEETS_WEBHOOK_SECRET is not set");
    return Response.json({ error: "Sheet sync not configured" }, { status: 500 });
  }

  const lineItems = apiKey ? await fetchLineItems(session.id, apiKey) : null;
  const payload = buildSheetPayload(session, lineItems);

  // Apps Script web apps answer with a redirect; fetch follows it by default.
  const response = await fetch(sheetsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: sheetsSecret, stripeEventId: event.id, payment: payload }),
  });

  const text = await response.text();
  let result: { ok?: boolean; status?: string; error?: string } = {};
  try {
    result = JSON.parse(text);
  } catch {
    result = { ok: false, error: "Apps Script did not return JSON" };
  }

  // A non-2xx makes Stripe retry for up to 3 days, so failures are not lost.
  if (!response.ok || !result.ok) {
    console.error("Sheet sync failed", response.status, result.error || text.slice(0, 200));
    return Response.json({ error: "Sheet sync failed" }, { status: 502 });
  }

  return Response.json({ received: true, sheet: result.status });
};

export const config = {
  path: "/api/stripe-webhook",
};
