# PhotoGenius AI

Responsive React 19, Vite 8, and Tailwind CSS 4 frontend with a user-controlled camera and location upload flow.

## Run locally

From this `location-app` directory:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Camera and precise-location permissions require HTTPS or localhost.

## Capture flow

1. The user opens the capture dialog from the red camera button.
2. The app clearly explains that the photo and allowed location will be saved in the database.
3. The visible `Open Camera` click starts both camera and optional GPS permission requests.
4. The live front-camera stream appears in the video preview.
5. `Capture & Upload` converts the current frame to a JPEG `File`.
6. The frontend sends one multipart request to `POST /api/v1/captures`.
7. A successful request must return HTTP `201` with `{ "saved": true }`.
8. Camera tracks stop on capture, cancel, close, and component cleanup.

Nothing is captured or uploaded automatically.

## API request

The request is `multipart/form-data` with:

- `photo`: required JPEG file
- `latitude`: included only after successful GPS permission
- `longitude`: included only after successful GPS permission
- `accuracy`: included with valid GPS coordinates when it is finite and non-negative

The frontend deliberately does not set the `Content-Type` header. The browser adds the multipart boundary.

If location permission is denied, unavailable, or times out, none of the GPS fields are sent. The backend can then save its Geo-IP/raw-IP fallback with the photo.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `VITE_API_BASE_URL` | Recommended | Backend origin; defaults to `https://locationfinder-pdzb.onrender.com` |
| `VITE_API_TIMEOUT_MS` | No | Capture upload timeout; defaults to 45000 ms |
| `VITE_DEV_API_PROXY` | Local only | Optional Vite `/api` proxy target |

For Netlify, set:

```text
VITE_API_BASE_URL=https://locationfinder-pdzb.onrender.com
```

The backend must allow the deployed frontend origin in CORS.

## Hidden admin terminal

The public page has no visible admin button. Tap/click the `PhotoGenius AI` title five times within three seconds to open the admin login terminal.

- Credentials are sent only to the protected backend login endpoint.
- The access token is kept only in React memory and disappears when the admin terminal closes or the page reloads.
- The dashboard is read-only and loads paginated capture metadata.
- Saved photo bytes are requested only when an authenticated admin explicitly opens a record.
- No admin password, default credential, or secret is stored in the frontend.

The required Spring Boot implementation contract is in `BACKEND_ADMIN_PROMPT.md`.

## Manual verification

1. Open the deployed site over HTTPS.
2. Click the red camera button and confirm no browser permission has appeared yet.
3. Read the database-storage notice and click `Open Camera`.
4. Confirm camera and location prompts start from that click.
5. Allow both permissions, capture, and verify one `/api/v1/captures` request contains the photo and GPS fields.
6. Repeat while denying location and verify the upload still works without latitude, longitude, or accuracy.
7. Cancel before capture and confirm the browser camera indicator switches off.
8. Confirm success is shown only for status `201` and `saved: true`.
