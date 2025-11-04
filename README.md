# ConPatas – Running and Testing Guide

This project contains both a Firebase-backed API (the `backend/` folder) and a Vite/React frontend (the `frontend/` folder). The backend handles dog publications and adoption request emails, while the frontend consumes the API and falls back to Firebase client helpers when the API is unavailable.

## Prerequisites

- Node.js 18 or newer
- npm 9 or newer
- A Firebase project with Firestore and Authentication enabled
- (Optional) A SendGrid account for adoption-request emails

## 1. Configure Environment Variables

### Backend

1. Copy the example environment file:
   ```bash
   cp backend/.env.example backend/.env
   ```
2. Fill in the values in `backend/.env`:
   - `FIREBASE_PROJECT_ID`: Firebase project id.
   - Provide **one** of the following credential options so Firebase Admin can authenticate:
     - Place your service account JSON at `backend/serviceAccount.json`.
     - Set `FIREBASE_SERVICE_ACCOUNT_FILE` to the path of the JSON file.
     - Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of the JSON file.
     - Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the raw JSON string (quotes escaped) or `FIREBASE_SERVICE_ACCOUNT_BASE64` to a base64-encoded copy.
   - `SENDGRID_API_KEY` and `EMAIL_FROM` if you want emails sent through SendGrid (optional).
   - Update `CLIENT_BASE_URL` and `ALLOWED_ORIGINS` to match the frontend URL you will use locally.

### Frontend

1. Copy the frontend example environment file:
   ```bash
   cp frontend/.env.example frontend/.env
   ```
2. Set `VITE_API_BASE_URL` to the URL where the backend will run (default `http://localhost:4000`).

## 2. Install Dependencies

Run the following commands once:

```bash
npm install                 # installs root dependencies (husky, etc.)
npm --prefix backend install
npm --prefix frontend install
```

## 3. Start the Backend Locally

```bash
npm --prefix backend run dev
```

By default the Express server listens on `http://localhost:4000`. The command uses `nodemon` (see `backend/package.json`) so it automatically reloads when backend files change.

### Health Check

Use `curl` or a browser to verify the API is responding:

```bash
curl http://localhost:4000/health
```

A JSON response with `{ "status": "ok" }` confirms the backend is up.

### Publications API

With valid Firebase credentials, these endpoints can be exercised:

- List dogs: `GET /dogs`
- Create a dog publication: `POST /dogs` (requires Firebase ID token in the `Authorization: Bearer <token>` header). Example payload:
  ```json
  {
    "name": "Fido",
    "age": "1 año",
    "breed": "Mestizo",
    "size": "mediano",
    "description": "Muy amigable",
    "images": ["https://.../fido.jpg"]
  }
  ```
- Fetch a single dog: `GET /dogs/:id`
- Submit an adoption request email: `POST /adoption-request`

Use Firebase Auth to obtain an ID token for the `POST /dogs` route. If `sgMail` is not configured, the adoption endpoint will respond successfully but log that email sending is disabled.

## 4. Start the Frontend Locally

```bash
npm --prefix frontend run dev
```

Vite prints the local URL (usually `http://localhost:5173`). Ensure this matches the origins configured in `backend/.env` so CORS checks succeed.

The frontend automatically uses the backend endpoints when `VITE_API_BASE_URL` is reachable; otherwise it falls back to Firestore client helpers.

## 5. Production Builds / Smoke Tests

To validate production builds and ensure TypeScript compiles:

```bash
npm --prefix backend run build   # transpiles backend if you add build scripts
npm --prefix frontend run build
```

(Only the frontend currently has a build output; the backend is plain Node.js.)

## 6. Troubleshooting

- **Invalid Firebase credentials** – check the service account path/env variables and that the private key keeps newline characters (`\n`).
- **CORS errors** – confirm `CLIENT_BASE_URL` and `ALLOWED_ORIGINS` in `backend/.env` include the frontend origin.
- **Emails not sent** – ensure `SENDGRID_API_KEY` and `EMAIL_FROM` are set and that the SendGrid dependency is installed (`npm --prefix backend install`).

With the backend and frontend both running, you can exercise the dog publication workflow end-to-end from the UI or via direct API calls.
