type DriveFile = { id: string; name: string };

function slugifyName(name: string): string {
  return name
    .replace(/\.[a-zA-Z0-9]+$/, "") // strip file extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default async (request: Request) => {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const folderId = Netlify.env.get("GOOGLE_DRIVE_FLYERS_FOLDER_ID");
  const apiKey = Netlify.env.get("GOOGLE_DRIVE_API_KEY");

  if (!folderId || !apiKey) {
    return Response.json({ error: "The flyer folder is not configured yet." }, { status: 500 });
  }

  try {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: "files(id,name)",
      pageSize: "1000",
      key: apiKey,
    });

    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    if (!response.ok) throw new Error(`Drive API returned ${response.status}`);

    const body = (await response.json()) as { files?: DriveFile[] };

    // Direct-embeddable image URL for a publicly shared Drive file.
    // Works as a plain <img src> without any auth as long as the file
    // (or its parent folder) is shared "Anyone with the link".
    const flyers = (body.files || []).map((file) => ({
      slug: slugifyName(file.name),
      url: `https://lh3.googleusercontent.com/d/${file.id}=w800`,
    }));

    return Response.json(
      { flyers },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=1800" } },
    );
  } catch (error) {
    console.error("Unable to read the flyers folder", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The flyer folder could not be loaded right now." }, { status: 502 });
  }
};

export const config = {
  path: "/api/flyers",
};
