# LeadHunter CRM

A local, self-hosted lead management CRM that scrapes Google Maps for business leads and lets you manage them with a full sales pipeline.

![LeadHunter CRM](https://img.shields.io/badge/version-2.0.0-green) ![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Google Maps Scraping** — Search for businesses by keyword + city using Apify
- **Full CRM Pipeline** — Track leads through custom statuses
- **Lead Management** — Add, edit, delete leads with full detail forms
- **Smart Filters** — Filter by status, name, phone, address, notes
- **Pagination** — Configurable rows per page (10 / 25 / 50 / 100)
- **Export** — Download leads as CSV or Excel (XLSX), copy phone numbers
- **Session System** — Each search is saved as a session; manage multiple cities
- **Result Filters** — Filter by min rating, min reviews, phone required
- **Zero Cloud** — All data stored locally on your machine

---

## Lead Statuses

| Status | Use Case |
|---|---|
| New | Freshly scraped, not contacted |
| Contacted | You've reached out |
| Interested | Lead showed interest |
| Follow-up | Needs a follow-up call/message |
| Scheduled | Meeting/call scheduled — shows date |
| Callback | They asked you to call back |
| Won | Deal closed |
| Not Interested | Lead declined |
| Too Expensive | Price objection |
| Already Has | Using a competitor |
| Wrong Lead | Incorrect/irrelevant data |
| Lost | Deal lost |
| No Reply | No response after attempts |

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- An [Apify](https://apify.com) account (free tier works)

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/vineetdev02/lead-machine.git
cd lead-machine
```

### 2. Install dependencies

```bash
npm install
```

### 3. Get your Apify token

1. Sign up at [apify.com](https://apify.com) (free)
2. Go to **Settings → Integrations**
3. Copy your **API token**

### 4. Add your token

Either add it via the app UI (Settings button), or create a `.env` file:

```env
APIFY_TOKEN=apify_api_your_token_here
PORT=3005
```

### 5. Run the app

```bash
# Development (auto-restart on code changes)
npm run dev

# Production
npm start
```

Open **http://localhost:3005** in your browser.

> **Note:** Port 6000 is blocked by Chrome. Use 3005 or any port above 1024 that isn't blocked.

---

## Usage Guide

### Generating Leads

1. Click **+ Generate** in the sidebar
2. Add keywords (e.g. `Car Rental`, `Taxi Service`) — press Enter or comma to add multiple
3. Enter a **City** name (required)
4. Choose **Max Results** and **Search Coverage**
5. Optionally expand **Result Filters** to filter by rating, reviews, or phone
6. Click **Search Google Maps**
7. Wait for Apify to finish — leads are saved automatically

### Managing Leads

- **Quick status change** — Click the status dropdown in the table row
- **Edit lead** — Click the ✏ button or click the Notes cell
- **Scheduled leads** — When status is `Scheduled`, set a follow-up date — it shows in purple 📅
- **Maps link** — Click ↗ to open the business on Google Maps
- **Copy phone** — Hover over a row and click ⧉ next to the phone number

### Exporting

Click **↓ Export** in the top right:
- **CSV** — Standard comma-separated file
- **Excel (XLSX)** — Formatted spreadsheet
- **Copy Phones** — Copies all phone numbers to clipboard

### Sessions

- Each Generate run creates a new session
- Sessions are grouped by category in the sidebar
- Delete a session via the **×** button next to it in the sidebar

---

## Project Structure

```
lead-machine/
├── server.js          # Express server + all API routes
├── public/
│   └── index.html     # Full frontend (single-file app)
├── Data/              # Generated lead data (gitignored)
│   └── <Category>/
│       ├── city_date.json
│       ├── city_date.csv
│       └── city_date.xlsx
├── .env               # Your Apify token (gitignored)
├── package.json
└── README.md
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/:cat/:file` | Get a single session |
| POST | `/api/sessions` | Save a new session |
| DELETE | `/api/sessions/:cat/:file` | Delete a session |
| PATCH | `/api/sessions/:cat/:file/leads/:idx` | Update a lead |
| POST | `/api/sessions/:cat/:file/leads` | Add a lead |
| DELETE | `/api/sessions/:cat/:file/leads/:idx` | Delete a lead |
| GET | `/api/export/:cat/:file/csv` | Export as CSV |
| GET | `/api/export/:cat/:file/xlsx` | Export as Excel |
| GET | `/api/export/:cat/:file/phones` | Get phone list |
| GET | `/api/token` | Check token status |
| POST | `/api/token` | Save Apify token |
| POST | `/api/apify/run` | Start an Apify scrape |
| GET | `/api/apify/run/:id` | Poll run status |
| GET | `/api/apify/run/:id/results` | Fetch run results |

---

## Troubleshooting

**`ERR_UNSAFE_PORT` in browser**
Chrome blocks certain ports (including 6000). Change `PORT=3005` in `.env`.

**`nodemon` restarting during lead generation**
Fixed in v2 — nodemon only watches `server.js`, not the `Data/` folder.

**`No APIFY_TOKEN found`**
Add your token via the **Settings** button in the app, or add it to `.env`.

**`Failed to fetch` on save**
Usually caused by the server restarting mid-request. Make sure you're using `npm run dev` (not `node server.js`) and the nodemon fix is in place.

---

## Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** Vanilla JS, HTML/CSS (no framework)
- **Scraping:** Apify — [Google Maps Crawler](https://apify.com/compass/crawler-google-places)
- **Export:** SheetJS (xlsx)
- **Dev:** nodemon

---

## License

MIT
