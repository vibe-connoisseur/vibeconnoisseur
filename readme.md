# Vibe Connoisseur

A dark-mode London event map powered by a published Google Sheet and a Netlify Function. The site maps every event, opens full ticket details from each marker, and filters the list by date, event type, age range, and London region.

## Google Sheet format

The connected sheet uses these columns:

```text
Title,Type of Event,Date,Location,Age Range,Tickets From,Vibe Approved,Ticket Link
```

Dates are accepted in `DD/MM/YYYY` format. Locations should include a complete UK postcode so the server can place the event on the map and assign it to East, South, West, or North West London. Set `Vibe Approved` to `Yes` to display the approval badge. The function converts dates to a consistent format, geocodes postcodes through Postcodes.io, validates ticket links, and returns the map-ready data from `/api/events`.

The current published sheet is configured as a default source. It can be replaced without editing code by setting `GOOGLE_SHEET_CSV_URL` in Netlify to another published CSV URL using the same column structure.

## Local development

Run the project with Netlify Dev so the event API is available:

```bash
netlify dev --port 8889
```

## Main files

- `index.html` contains the page structure and filter controls.
- `styles.css` contains the responsive dark editorial design.
- `app.js` renders the map, event cards, popups, and filters.
- `netlify/functions/events.mts` reads the sheet and geocodes each event.
