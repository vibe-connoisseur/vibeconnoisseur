type SheetEvent = {
  id: string;
  title: string;
  type: string[];
  date: string;
  location: string;
  postcode: string;
  region: string;
  ageRange: string;
  price: string;
  ticketUrl: string;
  vibeApproved: boolean;
  latitude: number;
  longitude: number;
  tags: string[];
};

type PostcodeResult = {
  query: string;
  result: { latitude: number; longitude: number } | null;
};

const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT53066usuQvIHnL08j_9XTFmW94Nkj4SRDQHS_OdQAsmpK9uMcEvGuX6l-Ji9m4ztZcEXvMc0LHEHW/pub?gid=909209203&single=true&output=csv";

const KNOWN_COORDINATES: Record<string, [number, number]> = {
  "SW9 6LH": [51.470969, -0.11197],
  "WC2H 8LH": [51.515741, -0.129159],
  "CR4 4JA": [51.397635, -0.157859],
  "SE16 2ET": [51.494206, -0.057447],
  "SE19 2BB": [51.418998, -0.067743],
  "SE10 0JH": [51.501113, -0.001277],
};

// Used when a sheet row has no specific address (blank, or marked TBC) but
// does mention a general London area in the location text.
const REGION_FALLBACKS: Record<string, { postcode: string; latitude: number; longitude: number }> = {
  "west london": { postcode: "WC1", latitude: 51.5225, longitude: -0.1225 },
  "south london": { postcode: "SE1", latitude: 51.5045, longitude: -0.0865 },
  "north london": { postcode: "N1", latitude: 51.5362, longitude: -0.1033 },
  "east london": { postcode: "E1", latitude: 51.515, longitude: -0.0722 },
  london: { postcode: "SE1", latitude: 51.5045, longitude: -0.0865 },
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

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

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
}

function normalizeDate(value: string): string {
  const match = value.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return value;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function extractPostcode(value: string): string {
  return value.toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/)?.[1].replace(/\s+/g, " ") || "";
}

function regionFromPostcode(postcode: string): string {
  const area = postcode.match(/^[A-Z]+/)?.[0] || "";
  if (["E", "EC", "IG", "RM"].includes(area)) return "East London";
  if (["SE", "SW", "CR", "BR", "SM"].includes(area)) return "South London";
  if (["W", "WC", "TW", "UB", "KT"].includes(area)) return "West London";
  if (["N", "NW", "EN", "WD", "HA"].includes(area)) return "North West London";
  return "";
}

function isYes(value = ""): boolean {
  return ["yes", "y", "true", "1"].includes(value.trim().toLowerCase());
}

function safeTicketUrl(value: string): string {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function parseTags(value: string): string[] {
  if (!value.trim()) return [];
  const pieces = value.includes(",") ? value.split(",") : value.split(/\s+/);
  return [...new Set(pieces.map((tag) => tag.trim()).filter(Boolean))];
}

function splitTypes(value: string): string[] {
  const types = value
    .split(/\s*(?:,|\/|&|\band\b)\s*/i)
    .map((type) => type.trim())
    .filter(Boolean);
  return types.length ? types : ["Other"];
}

function fallbackForLocation(location: string): { postcode: string; latitude: number; longitude: number } | null {
  const lower = location.toLowerCase();
  const order = ["west london", "south london", "north london", "east london", "london"];
  for (const key of order) {
    if (lower.includes(key)) return REGION_FALLBACKS[key];
  }
  return null;
}

async function geocodePostcodes(postcodes: string[]): Promise<Map<string, [number, number]>> {
  const uniquePostcodes = [...new Set(postcodes.filter(Boolean))];
  const coordinates = new Map<string, [number, number]>();

  if (uniquePostcodes.length) {
    try {
      const response = await fetch("https://api.postcodes.io/postcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcodes: uniquePostcodes }),
      });

      if (response.ok) {
        const body = await response.json() as { result?: PostcodeResult[] };
        for (const item of body.result || []) {
          if (item.result) coordinates.set(item.query, [item.result.latitude, item.result.longitude]);
        }
      }
    } catch (error) {
      console.error("Postcode lookup failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  for (const postcode of uniquePostcodes) {
    if (!coordinates.has(postcode) && KNOWN_COORDINATES[postcode]) coordinates.set(postcode, KNOWN_COORDINATES[postcode]);
  }

  return coordinates;
}

export default async (request: Request) => {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const sheetUrl = Netlify.env.get("GOOGLE_SHEET_CSV_URL") || DEFAULT_SHEET_URL;

  try {
    const response = await fetch(sheetUrl, { headers: { Accept: "text/csv" } });
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);

    const rows = parseCsv(await response.text());
    if (rows.length < 2) return Response.json({ events: [], updatedAt: new Date().toISOString() });

    const headers = rows[0].map(normalizeHeader);
    const records = rows.slice(1).map((values) =>
      Object.fromEntries(headers.map((header, column) => [header, values[column] || ""])),
    );

    const recordPostcodes = records.map((record) => extractPostcode(record.location));
    const coordinates = await geocodePostcodes(recordPostcodes.filter(Boolean));
    const today = new Date().toISOString().slice(0, 10);

    const events = records.map((record, index): SheetEvent | null => {
      let postcode = recordPostcodes[index];
      let position = postcode ? coordinates.get(postcode) : undefined;
      let region = postcode ? regionFromPostcode(postcode) : "";

      if (!position || !region) {
        const fallback = fallbackForLocation(record.location);
        if (fallback) {
          postcode = fallback.postcode;
          position = [fallback.latitude, fallback.longitude];
          region = regionFromPostcode(fallback.postcode);
        }
      }

      const date = normalizeDate(record.date);
      if (!record.title || !date || !record.location || !position || !region) return null;

      return {
        id: `${record.title}-${date}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        title: record.title,
        type: splitTypes(record.type_of_event || "Other"),
        date,
        location: record.location,
        postcode,
        region,
        ageRange: record.age_range || "All ages",
        price: record.tickets_from || "See tickets",
        ticketUrl: safeTicketUrl(record.ticket_link),
        vibeApproved: isYes(record.vibe_approved),
        latitude: position[0],
        longitude: position[1],
        tags: parseTags(record.additional_tags || ""),
      };
    }).filter((event): event is SheetEvent => event !== null)
      .filter((event) => event.date >= today)
      .sort((first, second) => first.date.localeCompare(second.date));

    return Response.json(
      { events, updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (error) {
    console.error("Unable to read the event sheet", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The event sheet could not be loaded right now." }, { status: 502 });
  }
};

export const config = {
  path: "/api/events",
};
