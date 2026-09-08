# Script Scheduler

A consolidated script scheduling application that combines the strongest parts of the original Node/SQLite, React, and vanilla JavaScript implementations into one application.

## Features

- Upload `.sh` and `.bat` scripts up to 1MB
- Custom script names and Linux/macOS or Windows platform selection
- Recurring schedules in minutes, hours, or days
- Optional start and end times
- Run immediately when a schedule is created
- Persistent schedules and execution history through SQLite
- Real script execution on the backend
- Last-run status, next-run time, and recent execution logs
- Search and status filtering for scheduled jobs
- Cancel schedules or permanently delete schedules and execution history
- Responsive browser UI
- Health endpoint for deployment checks

## Repository layout

```text
backend/
  package.json
  server.js
frontend/
  package.json
  index.html
  src/
    main.jsx
    styles.css
package.json
README.md
```

## Local development

Prerequisites: Node.js 20+ and npm.

```bash
npm install
npm start
```

The API starts on `http://localhost:3001` and the Vite frontend starts on `http://localhost:5173`.

To point the frontend at another API:

```bash
VITE_API_BASE_URL=http://localhost:3001/api npm --workspace frontend run start
```

## Production

Build the frontend with:

```bash
npm --workspace frontend run build
```

Run the API with:

```bash
npm --workspace backend start
```

The API stores application data under `backend/data` by default. Configure `PORT`, `UPLOAD_DIR`, `LOGS_DIR`, `DB_PATH`, and `ALLOWED_ORIGINS` through environment variables for a deployment environment.

## API

- `POST /api/scripts` — upload a script
- `GET /api/scripts` — list scripts
- `POST /api/schedules` — create a schedule
- `GET /api/schedules` — list active schedules
- `GET /api/schedules/:id/logs` — view execution history
- `POST /api/schedules/:id/cancel` — cancel a schedule
- `DELETE /api/schedules/:id` — delete a schedule and its execution history
- `GET /api/health` — health check
