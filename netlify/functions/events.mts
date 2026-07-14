const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT53066usuQvIHnL08j_9XTFmW94Nkj4SRDQHS_OdQAsmpK9uMcEvGuX6l-Ji9m4ztZcEXvMc0LHEHW/pub?gid=909209203&single=true&output=csv";

type SheetEvent = {
  id: string;
  title: string;
  category: string;
  venue: string;
  location: string;
  ageRange: string;
  price: string;
  ticketUrl: string;
  latitude: number;
  longitude: number;
};

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const next = csv[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
}

function eventId(title: string, index: number): string {
  return `${title}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function splitLocation(value: string): { venue: string; postcode: string } {
  const postcode = value.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0] || "";
  const venue = value.replace(new RegExp(`,?\\s*${postcode}$`, "i"), "").trim();
  return { venue: venue || value, postcode: postcode.toUpperCase() };
}

async function geocodePostcode(postcode: string): Promise<{ latitude: number; longitude: number } | null> {
  if (!postcode) return null;
  const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
  if (!response.ok) return null;
  const data = await response.json();
  const latitude = Number(data?.result?.latitude);
  const longitude = Number(data?.result?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

async function toEvent(record: Record<string, string>, index: number): Promise<SheetEvent | null> {
  const title = record.title || record.event || record.name;
  const location = record.location || record.address || record.venue;
  if (!title || !location) return null;

  const { venue, postcode } = splitLocation(location);
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  const coordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : await geocodePostcode(postcode);
  if (!coordinates) return null;

  return {
    id: record.id || eventId(title, index),
    title,
    category: record.type_of_event || record.category || record.type || "Event",
    venue,
    location,
    ageRange: record.age_range || record.age || "",
    price: record.tickets_from || record.price || "",
    ticketUrl: record.ticket_link || record.ticket_url || record.url || "",
    ...coordinates,
  };
}

export default async (request: Request) => {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const sheetUrl = Netlify.env.get("GOOGLE_SHEET_CSV_URL") || DEFAULT_SHEET_URL;

  try {
    const response = await fetch(sheetUrl, { headers: { Accept: "text/csv" } });
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
    const rows = parseCsv(await response.text());
    if (rows.length < 2) return Response.json({ events: [], updatedAt: new Date().toISOString() });

    const headers = rows[0].map(normalizedHeader);
    const records = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, column) => [header, values[column] || ""])));
    const events = (await Promise.all(records.map(toEvent))).filter((event): event is SheetEvent => event !== null);

    return Response.json(
      { events, updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (error) {
    console.error("Unable to read the configured Google Sheet", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The event sheet could not be read right now." }, { status: 502 });
  }
};

export const config = { path: "/api/events" };
