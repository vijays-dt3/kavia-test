# MAWOS Frontend

A React/Vite implementation of the MAWOS maintenance operations frontend. It supports the primary manual condition-reading journey, alert triage, work-order creation, parts evidence, and evidence-based closure.

## Run locally

```bash
npm install
npm run dev
```

Without an API configuration, the app runs a fully interactive demonstration workspace using local sample data.

## Connect to MAWOS API

Copy `.env.example` to an environment file managed by your deployment workflow and set `VITE_MAWOS_API_BASE_URL` to the versioned MAWOS API base path, such as `https://api.example.com/api/v1`.

The frontend uses the documented endpoints for equipment, readings, alerts, and work orders. It does not assume a `GET /workorders/{id}` endpoint; selected work-order editing remains list-driven until that contract is added.
