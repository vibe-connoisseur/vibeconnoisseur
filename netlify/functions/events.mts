import { flyerPublicUrl, serviceFetch, supabaseEnv } from "../lib/supabase.mts";

type SheetEvent = {
  id: string;
  title: string;
  type: string[];
  date: string;
  location: string;
  postcode: string;
  region: string;
  city: string;
  hub: string;
  ageRange: string;
  price: string;
  priceType: "paid" | "free" | "free_before" | "unknown";
  freeBefore: string;
  startTime: string;
  endTime: string;
  lineup: string;
  music: string;
  dressCode: string;
  ticketUrl: string;
  vibeApproved: boolean;
  latitude: number;
  longitude: number;
  approximateLocation: boolean;
  tags: string[];
  flyerImageUrl: string;
  flyerUrl: string;
  description: string;
  instagram: string[];
  source: "sheet" | "submission";
};

type SkippedRow = { row: number; title: string; reason: string };

type PostcodeResult = {
  query: string;
  result: { latitude: number | null; longitude: number | null } | null;
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
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Always returns "OUTCODE INCODE" with a single space, so "SW96LH",
// "sw9 6lh" and "SW9  6LH" all match the same lookup key.
function normalizePostcode(value: string): string {
  const compact = value.toUpperCase().replace(/\s+/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

function extractPostcode(value: string): string {
  const match = value.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return match ? normalizePostcode(match[1]) : "";
}

function regionFromPostcode(postcode: string): string {
  const area = postcode.match(/^[A-Z]+/)?.[0] || "";
  if (["E", "EC", "IG", "RM"].includes(area)) return "East London";
  if (["SE", "SW", "CR", "BR", "SM"].includes(area)) return "South London";
  if (["W", "WC", "TW", "UB", "KT"].includes(area)) return "West London";
  if (["N", "EN"].includes(area)) return "North London";
  if (["NW", "WD", "HA"].includes(area)) return "North West London";
  return "";
}

// Cities by postcode area. London is every London-area postcode; add more
// here as the app grows. Anything else uses the "City" column in the sheet,
// or the town postcodes.io gives back.
const CITY_BY_AREA: Record<string, string> = {
  E: "London", EC: "London", IG: "London", RM: "London", SE: "London", SW: "London", CR: "London", BR: "London",
  SM: "London", W: "London", WC: "London", TW: "London", UB: "London", KT: "London", N: "London", EN: "London",
  NW: "London", WD: "London", HA: "London", DA: "London",
  M: "Manchester", B: "Birmingham", L: "Liverpool", LS: "Leeds", BS: "Bristol", NG: "Nottingham", S: "Sheffield",
  G: "Glasgow", EH: "Edinburgh", CF: "Cardiff", NE: "Newcastle", LE: "Leicester", CV: "Coventry", BN: "Brighton",
  MK: "Milton Keynes", LU: "Luton", RG: "Reading", OX: "Oxford", CB: "Cambridge", SO: "Southampton",
  PO: "Portsmouth", BT: "Belfast", BD: "Bradford", WV: "Wolverhampton", NN: "Northampton", SS: "Southend",
  CM: "Chelmsford", AB: "Aberdeen", DD: "Dundee", PL: "Plymouth", EX: "Exeter", HU: "Hull", SR: "Sunderland",
  ME: "Kent", CT: "Kent", BA: "Bath", DE: "Derby", ST: "Stoke", PR: "Preston", BL: "Bolton", OL: "Oldham",
};

// Rough city centres, used when a row names the city but has no postcode.
const CITY_CENTRES: Record<string, [number, number]> = {
  manchester: [53.4808, -2.2426], birmingham: [52.4862, -1.8904], liverpool: [53.4084, -2.9916],
  leeds: [53.8008, -1.5491], bristol: [51.4545, -2.5879], nottingham: [52.9548, -1.1581],
  sheffield: [53.3811, -1.4701], glasgow: [55.8642, -4.2518], edinburgh: [55.9533, -3.1883],
  cardiff: [51.4816, -3.1791], newcastle: [54.9783, -1.6178], leicester: [52.6369, -1.1398],
  brighton: [50.8225, -0.1372], coventry: [52.4068, -1.5197], reading: [51.4543, -0.9781],
};

// The three regions people pick from in the app. Each has its own tab in the
// sheet (same columns as Event Tracker). Override with GOOGLE_SHEET_TABS,
// e.g. "909209203:London,909209301:Manchester,909209302:Midlands".
const DEFAULT_TABS = "909209203:London,909209301:Manchester,909209302:Midlands";
const HUB_BY_AREA: Record<string, string> = {
  M: "Manchester", BL: "Manchester", OL: "Manchester", SK: "Manchester", WN: "Manchester", WA: "Manchester",
  B: "Midlands", CV: "Midlands", WV: "Midlands", DY: "Midlands", WS: "Midlands", NG: "Midlands",
  LE: "Midlands", DE: "Midlands", NN: "Midlands", ST: "Midlands", TF: "Midlands", WR: "Midlands", LN: "Midlands",
};

function hubFromPostcode(postcode: string): string {
  const area = postcode.match(/^[A-Z]+/)?.[0] || "";
  if (HUB_BY_AREA[area]) return HUB_BY_AREA[area];
  return CITY_BY_AREA[area] === "London" ? "London" : "";
}

function cityFromPostcode(postcode: string): string {
  return CITY_BY_AREA[postcode.match(/^[A-Z]+/)?.[0] || ""] || "";
}

function titleCase(value: string): string {
  return value.trim().toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

// Turns "Tickets From" (or a brand's price choice) into a clear price.
function readPrice(raw: string, type = "", freeBefore = ""): { price: string; priceType: SheetEvent["priceType"]; freeBefore: string } {
  const text = raw.trim();
  const money = (value: string) => {
    const clean = value.replace(/^from\s+/i, "").trim();
    return /^\d+(\.\d{1,2})?$/.test(clean) ? `£${clean}` : clean;
  };
  if (type === "free") return { price: "Free", priceType: "free", freeBefore: "" };
  if (type === "free_before") return { price: text ? money(text) : "", priceType: "free_before", freeBefore: freeBefore.trim() };
  const before = text.match(/free\s+(?:entry\s+)?before\s+([0-9:.apm\s]+)(?:[,;/]\s*(?:then\s+)?(?:from\s+)?(.*))?/i);
  if (before) return { price: before[2] ? money(before[2]) : "", priceType: "free_before", freeBefore: before[1].trim() };
  if (/^(free|free entry|£?0(\.00)?)$/i.test(text)) return { price: "Free", priceType: "free", freeBefore: "" };
  if (!text) return { price: "See tickets", priceType: "unknown", freeBefore: "" };
  return { price: money(text), priceType: "paid", freeBefore: "" };
}

function isYes(value = ""): boolean {
  return ["yes", "y", "true", "1"].includes(value.trim().toLowerCase());
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

// Converts Google Drive share links (file/d/, open?id=, uc?id=) and Dropbox
// share links into direct image URLs that can be embedded in the flyer rails.
function toDirectImageUrl(value: string): string {
  const url = safeUrl(value);
  if (!url) return "";

  const driveId =
    url.match(/drive\.google\.com\/file\/d\/([\w-]+)/)?.[1] ||
    url.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]+)/)?.[1];
  if (driveId) return `https://lh3.googleusercontent.com/d/${driveId}=w1000`;

  if (/(^|\.)dropbox\.com$/.test(new URL(url).hostname)) {
    const dropbox = new URL(url);
    dropbox.searchParams.delete("dl");
    dropbox.searchParams.set("raw", "1");
    return dropbox.href;
  }

  return url;
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

// postcodes.io's bulk lookup endpoint rejects requests over 100 postcodes,
// so lookups are chunked to keep every event geocoded regardless of sheet size.
const POSTCODES_IO_BATCH_LIMIT = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function geocodeOutcode(outcode: string): Promise<[number, number] | null> {
  try {
    const response = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`);
    if (!response.ok) return null;
    const body = await response.json() as { result?: { latitude: number | null; longitude: number | null } };
    const lat = body.result?.latitude;
    const lng = body.result?.longitude;
    return typeof lat === "number" && typeof lng === "number" ? [lat, lng] : null;
  } catch {
    return null;
  }
}

async function geocodePostcodes(postcodes: string[]): Promise<{
  coordinates: Map<string, [number, number]>;
  approximate: Set<string>;
}> {
  const uniquePostcodes = [...new Set(postcodes.filter(Boolean))];
  const coordinates = new Map<string, [number, number]>();
  const approximate = new Set<string>();

  await Promise.all(chunk(uniquePostcodes, POSTCODES_IO_BATCH_LIMIT).map(async (batch) => {
    try {
      const response = await fetch("https://api.postcodes.io/postcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcodes: batch }),
      });

      if (response.ok) {
        const body = await response.json() as { result?: PostcodeResult[] };
        for (const item of body.result || []) {
          const lat = item.result?.latitude;
          const lng = item.result?.longitude;
          if (typeof lat === "number" && typeof lng === "number") {
            coordinates.set(normalizePostcode(item.query), [lat, lng]);
          }
        }
      } else {
        console.error(`Postcode batch lookup returned ${response.status} for ${batch.length} postcodes`);
      }
    } catch (error) {
      console.error("Postcode lookup failed", error instanceof Error ? error.message : "Unknown error");
    }
  }));

  for (const postcode of uniquePostcodes) {
    if (!coordinates.has(postcode) && KNOWN_COORDINATES[postcode]) coordinates.set(postcode, KNOWN_COORDINATES[postcode]);
  }

  // Brand-new venues (new builds, recently opened arenas) often have postcodes
  // that postcodes.io does not know yet. Instead of dropping the event, place
  // it at the centre of its postcode district (e.g. "W14") and flag it.
  const missing = uniquePostcodes.filter((postcode) => !coordinates.has(postcode));
  await Promise.all(missing.map(async (postcode) => {
    const position = await geocodeOutcode(postcode.split(" ")[0]);
    if (position) {
      coordinates.set(postcode, position);
      approximate.add(postcode);
      console.warn(`Postcode ${postcode} not found; using district centre instead`);
    }
  }));

  return { coordinates, approximate };
}

// "@brand, @dj.name" or Instagram links -> ["brand", "dj.name"]. Used to link
// events to the Brand and DJ profiles people follow.
function parseHandles(value: string): string[] {
  return [...new Set(String(value)
    .split(/[,\s]+/)
    .map((part) => part.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@/, "").toLowerCase())
    .filter((handle) => /^[a-z0-9._]{2,30}$/.test(handle) && handle !== "unknown"))];
}

// Approved brand submissions, reshaped to look like sheet rows so they go
// through the same checks, geocoding and duplicate removal.
async function approvedSubmissions(): Promise<Array<{ row: number; record: Record<string, string> }>> {
  if (!supabaseEnv().ready) return [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const response = await serviceFetch(`/rest/v1/event_submissions?status=eq.approved&event_date=gte.${today}&select=*&order=event_date.asc`);
    if (!response.ok) {
      console.error("Could not load approved submissions", response.status);
      return [];
    }
    const rows = await response.json() as Array<Record<string, string | null>>;
    return rows.map((row, index) => {
      const [year, month, day] = String(row.event_date).split("-");
      return {
        row: 10000 + index,
        record: {
          title: row.title || "",
          approved: "Yes",
          additional_tags: row.tags || "",
          type_of_event: row.event_type || "Other",
          date: `${day}/${month}/${year}`,
          location: row.location || "",
          age_range: row.age_range || "18+",
          tickets_from: row.price || "",
          __price_type: row.price_type || "",
          __free_before: row.free_before || "",
          start_time: row.start_time || "",
          end_time: row.end_time || "",
          lineup: row.lineup || "",
          music: row.music || "",
          dress_code: row.dress_code || "",
          city: row.city || "",
          vibe_approved: "",
          flyer_image_url: flyerPublicUrl(row.flyer_path),
          ticket_link: row.ticket_url || "",
          description: row.description || "",
          instagram: row.instagram || "",
          __source: "submission",
        },
      };
    });
  } catch (error) {
    console.error("Approved submissions failed", error instanceof Error ? error.message : "Unknown error");
    return [];
  }
}

export default async (request: Request) => {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const debug = new URL(request.url).searchParams.has("debug");
  const sheetUrl = Netlify.env.get("GOOGLE_SHEET_CSV_URL") || DEFAULT_SHEET_URL;
  const tabs = (Netlify.env.get("GOOGLE_SHEET_TABS") || DEFAULT_TABS).split(",")
    .map((entry) => entry.trim().split(":"))
    .filter(([gid, hub]) => /^\d+$/.test(gid || "") && hub)
    .map(([gid, hub]) => ({ gid, hub: hub.trim(), url: sheetUrl.replace(/gid=\d+/, `gid=${gid}`) }));

  try {
    // Read every region's tab at once. London (the first tab) must load; a
    // region tab that isn't published yet is skipped and logged.
    const loaded = await Promise.all(tabs.map(async (tab, index) => {
      try {
        const response = await fetch(tab.url, { headers: { Accept: "text/csv" } });
        const text = await response.text();
        if (!response.ok || /^\s*<(!doctype|html)/i.test(text)) throw new Error(`Google Sheets returned ${response.status} (is the ${tab.hub} tab published?)`);
        return { tab, rows: parseCsv(text) };
      } catch (error) {
        if (index === 0) throw error;
        console.error("Region tab skipped", tab.hub, (error as Error).message);
        return { tab, rows: [] as string[][] };
      }
    }));

    let flyerKey = "flyer_image_url";
    // row = the row number as shown in Google Sheets (row 1 is the header).
    const allRecords = loaded.flatMap(({ tab, rows }) => {
      if (rows.length < 2) return [];
      const headers = rows[0].map(normalizeHeader);
      const flyerHeader = headers.find((header) => header.includes("flyer"));
      return rows.slice(1).map((values, position) => {
        const record = Object.fromEntries(headers.map((header, column) => [header, values[column] || ""])) as Record<string, string>;
        // Every tab's flyer column is read the same way, whatever its exact header.
        if (flyerHeader && flyerHeader !== flyerKey) record[flyerKey] = record[flyerHeader];
        record.__hub = tab.hub;
        return { row: position + 2, record, tab: tab.hub };
      });
    });

    const skipped: SkippedRow[] = [];

    // Only rows marked Approved reach the app. New form submissions land
    // in a separate tab, so they're invisible here until copied over
    // with Approved = Yes.
    const records = allRecords.filter(({ row, record }) => {
      if (isYes(record.approved)) return true;
      skipped.push({ row, title: `${record.title || "(no title)"}${record.__hub && record.__hub !== "London" ? ` [${record.__hub} tab]` : ""}`, reason: "Approved is not Yes" });
      return false;
    });

    // Brand uploads approved in the app join the sheet events here.
    const submissionRecords = await approvedSubmissions();
    records.push(...submissionRecords);

    const recordPostcodes = records.map(({ record }) => extractPostcode(record.location || ""));
    const { coordinates, approximate } = await geocodePostcodes(recordPostcodes);
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Map<string, number>();
    const events: SheetEvent[] = [];

    records.forEach(({ row, record }, index) => {
      const title = (record.title || "").trim();
      const location = (record.location || "").trim();
      const skip = (reason: string) => skipped.push({ row, title: title || "(no title)", reason });

      if (!title) return skip("Missing title");
      if (!location) return skip("Missing location");

      const date = normalizeDate(record.date || "");
      if (!date) return skip(`Date "${record.date}" is not in DD/MM/YYYY format`);
      if (date < today) return skip("Date has passed");

      let postcode = recordPostcodes[index];
      let position = postcode ? coordinates.get(postcode) : undefined;
      let isApproximate = postcode ? approximate.has(postcode) : false;
      let region = postcode ? regionFromPostcode(postcode) : "";

      const textFallback = fallbackForLocation(location);

      // Only use the general-area fallback when the row has no usable
      // position of its own. A real, geocoded postcode is never overwritten.
      if (!position && textFallback) {
        position = [textFallback.latitude, textFallback.longitude];
        isApproximate = true;
        if (!postcode) postcode = textFallback.postcode;
      }
      // City: the sheet's City column wins, then the postcode, then a city
      // named in the location text.
      const namedCity = Object.keys(CITY_CENTRES).find((name) => location.toLowerCase().includes(name)) || "";
      if (!position && namedCity) {
        position = CITY_CENTRES[namedCity];
        isApproximate = true;
      }
      const hub = record.__hub || hubFromPostcode(postcode) || (namedCity ? HUB_BY_AREA[Object.entries(CITY_BY_AREA).find(([, name]) => name.toLowerCase() === namedCity)?.[0] || ""] || "" : "") || "London";
      const city = titleCase(record.city || "") || cityFromPostcode(postcode) || (namedCity ? titleCase(namedCity) : "")
        || (textFallback && hub === "London" ? "London" : "") || (position ? (hub === "London" ? "London" : "UK") : "");
      if (city === "London") {
        if (!region && textFallback) region = regionFromPostcode(textFallback.postcode);
        if (!region && position) region = "London";
      } else {
        region = "";
      }

      if (!position) {
        return skip(postcode
          ? `Postcode ${postcode} could not be found`
          : "No postcode in Location and no city or London area mentioned");
      }

      const duplicateKey = `${title.toLowerCase()}|${date}|${(postcode || location).toLowerCase()}`;
      const firstRow = seen.get(duplicateKey);
      if (firstRow) return skip(`Duplicate of row ${firstRow}`);
      seen.set(duplicateKey, row);

      const flyerImageUrl = toDirectImageUrl(record[flyerKey] || "");

      events.push({
        id: `${title}-${date}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        title,
        type: splitTypes(record.type_of_event || "Other"),
        date,
        location,
        postcode,
        region,
        city,
        hub,
        ageRange: record.age_range || "All ages",
        ...readPrice(record.tickets_from || "", record.__price_type || "", record.__free_before || ""),
        startTime: (record.start_time || record.time || record.doors || "").trim().slice(0, 20),
        endTime: (record.end_time || "").trim().slice(0, 20),
        lineup: (record.lineup || record.line_up || "").trim().slice(0, 300),
        music: (record.music || record.genres || "").trim().slice(0, 200),
        dressCode: (record.dress_code || "").trim().slice(0, 200),
        ticketUrl: safeUrl(record.ticket_link || ""),
        vibeApproved: isYes(record.vibe_approved),
        latitude: position[0],
        longitude: position[1],
        approximateLocation: isApproximate,
        tags: parseTags(record.additional_tags || ""),
        flyerImageUrl,
        flyerUrl: flyerImageUrl,
        description: (record.description || "").trim().slice(0, 2000),
        instagram: parseHandles(record.instagram || ""),
        source: record.__source === "submission" ? "submission" : "sheet",
      });
    });

    events.sort((first, second) => first.date.localeCompare(second.date));

    const problems = skipped.filter((item) => item.reason !== "Date has passed" && item.reason !== "Approved is not Yes");
    if (problems.length) console.warn("Rows skipped:", JSON.stringify(problems));

    const payload: Record<string, unknown> = {
      events,
      updatedAt: new Date().toISOString(),
      rowsInSheet: allRecords.length,
      skippedCount: skipped.length,
    };
    if (debug) payload.skipped = skipped;

    return Response.json(payload, {
      headers: {
        "Cache-Control": debug
          ? "no-store"
          : "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("Unable to read the event sheet", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The event sheet could not be loaded right now." }, { status: 502 });
  }
};

export const config = {
  path: "/api/events",
};
