// Sends iPhone push notifications through Apple (APNs).
// Needs in Netlify: APNS_KEY (the .p8 file's contents), APNS_KEY_ID,
// APNS_TEAM_ID. Optional: APNS_BUNDLE_ID (defaults to the app's), and
// APNS_SANDBOX=true only for builds run straight from Xcode. TestFlight and
// App Store builds use the normal (production) server.
import { createPrivateKey, sign } from "node:crypto";
import { connect } from "node:http2";

const BUNDLE_ID = "com.vibeconnoisseur.wheresthevibe";

export type PushMessage = { title: string; body: string; data?: Record<string, string> };
export type PushResult = { token: string; ok: boolean; status: number; reason?: string };

export function apnsConfigured(): boolean {
  return Boolean(Netlify.env.get("APNS_KEY") && Netlify.env.get("APNS_KEY_ID") && Netlify.env.get("APNS_TEAM_ID"));
}

let cachedJwt: { value: string; at: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// Apple accepts the same signed token for up to an hour; reuse it for 50 minutes.
function providerToken(): string {
  if (cachedJwt && Date.now() - cachedJwt.at < 50 * 60 * 1000) return cachedJwt.value;
  const keyText = (Netlify.env.get("APNS_KEY") || "").replace(/\\n/g, "\n").trim();
  const key = createPrivateKey(keyText.includes("BEGIN") ? keyText : `-----BEGIN PRIVATE KEY-----\n${keyText}\n-----END PRIVATE KEY-----`);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: (Netlify.env.get("APNS_KEY_ID") || "").trim() }));
  const claims = base64url(JSON.stringify({ iss: (Netlify.env.get("APNS_TEAM_ID") || "").trim(), iat: Math.floor(Date.now() / 1000) }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  cachedJwt = { value: `${header}.${claims}.${base64url(signature)}`, at: Date.now() };
  return cachedJwt.value;
}

export async function sendPush(tokens: string[], message: PushMessage): Promise<PushResult[]> {
  if (!tokens.length || !apnsConfigured()) return [];
  const host = Netlify.env.get("APNS_HOST_OVERRIDE") // only used by local tests
    || (Netlify.env.get("APNS_SANDBOX") === "true" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
  const topic = (Netlify.env.get("APNS_BUNDLE_ID") || BUNDLE_ID).trim();
  const jwt = providerToken();
  const payload = JSON.stringify({
    aps: { alert: { title: message.title, body: message.body }, sound: "default" },
    ...(message.data || {}),
  });

  const client = connect(host);
  client.on("error", () => undefined);
  try {
    return await Promise.all(tokens.map((token) => new Promise<PushResult>((resolve) => {
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });
      let status = 0;
      let body = "";
      request.setEncoding("utf8");
      request.on("response", (headers) => { status = Number(headers[":status"]) || 0; });
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        let reason: string | undefined;
        try { reason = body ? JSON.parse(body).reason : undefined; } catch { reason = undefined; }
        resolve({ token, ok: status === 200, status, reason });
      });
      request.on("error", (error) => resolve({ token, ok: false, status: 0, reason: error.message }));
      request.setTimeout(8000, () => {
        request.close();
        resolve({ token, ok: false, status: 0, reason: "timeout" });
      });
      request.end(payload);
    })));
  } finally {
    client.close();
  }
}

// Tokens Apple says are dead and should be forgotten.
export function isDeadToken(result: PushResult): boolean {
  return result.status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(result.reason || "");
}
