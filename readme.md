# Vibe Connoisseur

A dark-mode London events map powered by a published Google Sheet and a Netlify Function. Curators update the spreadsheet; the site refreshes automatically without a rebuild or code change.

## Connect a Google Sheet

The connected sheet currently uses these headers:

```text
Title,Type of Event,Location,Age Range,Tickets From,Ticket Link
```

`Title` and `Location` are required. Put a UK postcode in the location (for example, `Venue Name, SW9 6LH`) so the server can place the event accurately on the map. Existing sheets with latitude and longitude columns remain supported.

Event types become map filters automatically, so new categories need no code changes.

In Google Sheets:

1. Choose **File → Share → Publish to web**.
2. Select the events tab and choose **Comma-separated values (.csv)**.
3. Publish and copy the generated URL.
4. In Netlify, add an environment variable named `GOOGLE_SHEET_CSV_URL` containing that URL.
5. Redeploy the site so the function can read the new environment variable.

The sheet is fetched server-side through `/api/events`. Responses are cached briefly, the browser refreshes every five minutes, and visitors can also use the **Refresh sheet** button.

## Local development

Run the site with Netlify Dev so the function route is available:

```bash
netlify dev --port 8889
```

Set `GOOGLE_SHEET_CSV_URL` in the Netlify project environment before starting local development. Do not add the published URL directly to client-side JavaScript.

## Main files

- `index.html` contains the page structure.
- `styles.css` contains the responsive editorial interface.
- `app.js` renders map markers, filters, event cards, and spreadsheet sync states.
- `netlify/functions/events.mts` reads and validates the published CSV feed.
