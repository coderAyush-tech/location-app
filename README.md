# PhotoGenius AI

Responsive React 19, Vite 8, and Tailwind CSS 4 frontend with consent-based camera, optional GPS, and live audio capture.

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
2. Before requesting permissions, the app explains that the microphone streams to the administrator while live and that a recording will be stored with a photo after capture.
3. Only `I agree / Start camera and mic` requests camera and microphone permissions.
4. The live camera preview appears first. After microphone permission, the frontend creates a consented live-audio room and opens the authenticated publisher WebSocket.
5. A persistent `MIC LIVE — admin can hear` indicator and Stop control are shown while the publisher is connected. Recording stops at 60 seconds or 2 MiB.
6. GPS remains optional; its permission prompt follows the microphone permission decision.
7. `Capture & Upload` converts the current frame to a JPEG and sends it with any completed recording in one multipart request to `POST /api/v1/captures`.
8. A successful request must return HTTP `201` with `{ "saved": true }`; `audioSaved` reports whether the recording was stored.
9. Cancel, Stop, connection failure, upload completion, and component cleanup close the live room and stop its media tracks.

Nothing is captured or uploaded automatically.

## API request

The request is `multipart/form-data` with:

- `photo`: required JPEG file
- `latitude`: included only after successful GPS permission
- `longitude`: included only after successful GPS permission
- `accuracy`: included with valid GPS coordinates when it is finite and non-negative
- `audio`: optional WebM, Ogg, MP4, or MPEG recording, limited to 2 MiB

The frontend deliberately does not set the `Content-Type` header. The browser adds the multipart boundary.

If location permission is denied, unavailable, or times out, none of the GPS fields are sent. The backend can then save its Geo-IP/raw-IP fallback with the photo.

## Admin audio

- After admin login the dashboard polls `GET /api/v1/admin/live-audio/sessions` and allows an authorized operator to listen to an active consented room.
- `Stop Listening` closes only the administrator's WebSocket.
- Capture details use the authenticated `GET /api/v1/admin/captures/{captureId}/audio` endpoint with no-store caching and a temporary object URL that is revoked when the detail closes.

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
- The dashboard loads paginated capture metadata and supports a two-step permanent delete for one selected record.
- Saved photo bytes are requested only when an authenticated admin explicitly opens a record.
- Delete requires an explicit second confirmation and calls the protected backend only for that selected capture ID.
- No admin password, default credential, or secret is stored in the frontend.

The required Spring Boot implementation contract is in `BACKEND_ADMIN_PROMPT.md`.

## Manual verification

1. Open the deployed site over HTTPS and click the red camera button; confirm there is no permission prompt yet.
2. Read the disclosure and click `I agree / Start camera and mic`.
3. Allow the camera, then the microphone. Confirm the preview works and `MIC LIVE — admin can hear` remains visible with a Stop control.
4. Sign in to the admin terminal, confirm the live room appears, choose `Listen live`, and use `Stop Listening`; the publisher should remain live.
5. Press `Capture & Upload`; verify one multipart capture request contains `photo`, optional GPS fields, and `audio` when recording is available.
6. Inspect the saved capture in admin, verify its audio status, and play the protected recording.
7. Repeat while denying microphone, denying GPS, stopping audio, disconnecting the WebSocket, and cancelling during a microphone prompt.
8. Confirm saved audio never exceeds 60 seconds or 2 MiB, and success requires status `201` with `saved: true`.

Run `npm test` for automated camera, microphone, recording, WebSocket, admin playback, and upload-contract checks.
