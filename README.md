# PhotoGenius AI

A responsive React + Tailwind conversion of the original PhotoGenius AI page.

## Run locally

1. Install packages: `npm install`
2. Start development: `npm run dev`
3. Create deployment files: `npm run build`

## API behaviour

- Precise permission granted: `POST /api/location` with `{ "latitude", "longitude" }`.
- Precise permission denied: `POST /api/location/fallback` with no body. This uses the request IP on the Spring backend, as required by the supplied controller.
- The deployed frontend uses `https://locationfinder-pdzb.onrender.com` by default, exactly like the original HTML version. `VITE_API_BASE_URL` is optional and only needed if the backend URL changes later.
- API requests time out after 15 seconds so the interface never remains stuck if a backend geolocation provider is unavailable.

## GitHub Pages deployment

This repository includes `.github/workflows/deploy-pages.yml`. Push it to the `master` branch, then open **Settings → Pages** in GitHub and choose **GitHub Actions** as the source. No environment variable is required for the current backend.

The Spring backend must allow your GitHub Pages origin in CORS (for example `https://YOUR_GITHUB_USERNAME.github.io`). The workflow builds from the committed `package-lock.json` and publishes `dist` automatically.

For Vercel, Netlify, or Cloudflare Pages, use build command `npm run build` and publish directory `dist`. No environment variable is required for the current backend.
