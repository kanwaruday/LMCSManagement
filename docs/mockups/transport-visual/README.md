# Transport views: three visual directions (mock-ups, not live)

`template.html` holds the three directions; it has no data on purpose (this repo is public, and stop locations and
times of school buses stay off it). A preview with real data is built locally:

    python3 -c "t=open('template.html').read(); open('preview.html','w').write(t.replace('__DATA__', open('<data>.json').read()))"

Data: `~/Projects/transport-gps` (stops.csv, trips.sqlite) + `transport/master_bus_table.csv`. No driver or student names.

- **A. Metro map (Mini Metro)** — merge two routes (shared stations), combine stops a few minutes apart, which lines lose money.
- **B. City overlay (Cities: Skylines)** — move a stop (500 m walking circles), two buses in one village (overlap), routes coloured by profit.
- **C. Depot (OpenTTD vehicle list)** — scrap a bus (age to the 15-year limit), fix a tracker (lamp), loss per bus, seats filled.

When the staff stop workbook comes back, its stop names and students per stop replace the GPS place names and size the
circles (B) and line widths (A). Waiting for Uday to choose a direction; nothing is deployed.
