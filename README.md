# PhotoGenius AI

Responsive React 19, Vite 8, and Tailwind CSS 4 frontend for the PhotoGenius AI photography assistant.

## Run locally

1. Run `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `VITE_API_BASE_URL` to the backend origin, or set `VITE_DEV_API_PROXY` when using a local Spring backend.
4. Run `npm run dev`.
5. Create a production build with `npm run build`.

Camera and precise-location permissions require HTTPS or localhost.

## Photo-session flow

The main camera button now starts this flow:

1. Explain camera and location permissions.
2. Request camera permission after the user clicks Continue.
3. Show the live camera with front/back switching when multiple devices are available.
4. Capture a JPEG `File`, preview it, and allow retake.
5. Request precise location after the user accepts the photo.
6. Create a backend photo session and upload the original as multipart form data.
7. Request backend AI enhancement and poll the session until completion.
8. Show a touch-friendly original/enhanced comparison slider.
9. Download, optionally enhance again, or retake.

Camera tracks stop after capture, when the flow closes, and when the component unmounts.

## Existing APIs preserved

These existing contracts remain centralized in `src/services/locationApi.js`:

- `POST /api/location`
- `POST /api/location/fallback`

The precise-location request keeps the existing `latitude`, `longitude`, `photoStyleId`, `source`, `timestamp`, and `accuracy` payload.

## New backend contract required

The frontend integration is centralized in `src/features/photoSession/photoSessionApi.js`. Its default relative paths are:

- `POST /api/v1/photo-sessions`
- `POST /api/v1/photo-sessions/{sessionId}/photo`
- `POST /api/v1/photo-sessions/{sessionId}/enhance`
- `GET /api/v1/photo-sessions/{sessionId}`

The upload request is `multipart/form-data` with:

- `photo`
- `latitude` when available
- `longitude` when available
- `accuracy` when available

The frontend accepts JPEG, PNG, and WebP files up to 10 MB. It does not set the multipart `Content-Type` header manually, so the browser supplies the required boundary.

The create response must contain `sessionId` or `id`. A completed session must contain `enhancedImageUrl`; `originalImageUrl`, `status`, and `canEnhanceAgain` are also supported.

Supported processing statuses include `CREATED`, `PHOTO_UPLOADED`, `PROCESSING`, `COMPLETED`, `FAILED`, `ERROR`, `CANCELLED`, and `EXPIRED`.

After `/enhance` returns `PROCESSING`, the frontend polls every two seconds for up to 90 attempts. Polling is cancelled when the flow closes, resets, or unmounts.

No Gemini key or direct Gemini request exists in the frontend.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `VITE_API_BASE_URL` | Recommended | Backend origin; defaults to `https://locationfinder-pdzb.onrender.com` |
| `VITE_PHOTO_SESSIONS_PATH` | No | Overrides `/api/v1/photo-sessions` |
| `VITE_API_TIMEOUT_MS` | No | Standard API timeout; defaults to 20000 ms |
| `VITE_DEV_API_PROXY` | Local only | Optional Vite `/api` proxy target |

The backend must allow the deployed frontend origin in CORS.

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. Add `VITE_API_BASE_URL` as a GitHub Actions repository variable. Add `VITE_PHOTO_SESSIONS_PATH` only when the backend uses a non-default path.

## Manual verification

1. Open the site over HTTPS.
2. Click the red camera button and confirm no browser permission appears before Continue.
3. Click Continue and allow the camera.
4. Switch cameras on a multi-camera phone.
5. Capture, verify the preview, and test Retake.
6. Capture again, choose Use Photo, and allow location.
7. Confirm session creation and original upload complete.
8. Click Enhance With AI once and confirm duplicate clicks are prevented.
9. Wait for `COMPLETED` and drag the before/after slider.
10. Download the enhanced image, then test Retake.
11. Repeat while denying camera and location to verify friendly recovery options.
12. Check the browser console for errors and confirm the camera indicator turns off after capture/close.
