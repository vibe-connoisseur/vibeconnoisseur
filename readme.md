# Vibe Connoisseur

A responsive London events map powered by a published Google Sheet and a Netlify Function. Curators update the spreadsheet; the site refreshes automatically without a rebuild or code change.

## Connect a Google Sheet

Create a sheet with these headers in the first row:

```text
id,title,category,date,start_time,end_time,venue,address,latitude,longitude,description,ticket_url,image_url,price,featured,published
```

Required fields are `title`, `date`, `venue`, `latitude`, and `longitude`. Use `YYYY-MM-DD` for dates and 24-hour `HH:MM` times. Set `published` to `TRUE` to show an event. If the `published` cell is empty, the event is also shown; set it to `FALSE` to hide the row.

Suggested categories are `Art`, `Music`, `Food`, `Film`, and `Culture`. New category names still work and receive the fallback marker color.

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
