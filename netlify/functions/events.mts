type SheetEvent = {
  id: string;
  title: string;
  category: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  address: string;
  latitude: number;
  longitude: number;
  description: string;
  ticketUrl: string;
  imageUrl: string;
  price: string;
  featured: boolean;
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
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isTruthy(value = ""): boolean {
  return ["true", "yes", "1", "y"].includes(value.trim().toLowerCase());
}

function toEvent(record: Record<string, string>, index: number): SheetEvent | null {
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  if (!record.title || !record.date || !record.venue || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (record.published && !isTruthy(record.published)) return null;

  return {
    id: record.id || `${record.date}-${record.title}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    title: record.title,
    category: record.category || "Other",
    date: record.date,
    startTime: record.start_time || "",
    endTime: record.end_time || "",
    venue: record.venue,
    address: record.address || "",
    latitude,
    longitude,
    description: record.description || "",
    ticketUrl: record.ticket_url || "",
    imageUrl: record.image_url || "",
    price: record.price || "",
    featured: isTruthy(record.featured),
  };
}

export default async (request: Request) => {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const sheetUrl = Netlify.env.get("GOOGLE_SHEET_CSV_URL");
  if (!sheetUrl) {
    return Response.json(
      { error: "Add GOOGLE_SHEET_CSV_URL in Netlify to connect the published spreadsheet." },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(sheetUrl, { headers: { Accept: "text/csv" } });
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
    const rows = parseCsv(await response.text());
    if (rows.length < 2) return Response.json({ events: [], updatedAt: new Date().toISOString() });

    const headers = rows[0].map(normalizedHeader);
    const events = rows.slice(1)
      .map((values, index) => Object.fromEntries(headers.map((header, column) => [header, values[column] || ""])))
      .map(toEvent)
      .filter((event): event is SheetEvent => event !== null)
      .sort((first, second) => `${first.date} ${first.startTime}`.localeCompare(`${second.date} ${second.startTime}`));

    return Response.json(
      { events, updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (error) {
    console.error("Unable to read the configured Google Sheet", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The Google Sheet could not be read. Check that it is published as CSV." }, { status: 502 });
  }
};

export const config = {
  path: "/api/events",
};
