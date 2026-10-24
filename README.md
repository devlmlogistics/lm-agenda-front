# LM Agenda Frontend

Testing frontend for LM Driver Agenda. The production build is served by Nginx.

Coolify build variable:

- `VITE_API_BASE_URL=https://nocobase.stdc.cl`

Testing URL: `https://forms.stdc.cl`

## Transport dashboard

Open `https://forms.stdc.cl/#/dashboard?key=<dashboard-key>` for the monitoring
screen. The key is stored only for the browser session and removed from the
visible URL. The screen can filter by date, refreshes every minute, and highlights
updates from the last 15 minutes.

