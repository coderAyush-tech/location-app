# PhotoGenius AI

A responsive React + Tailwind conversion of the original PhotoGenius AI page.

## Run locally

1. Install packages: `npm install`
2. Copy `.env.example` to `.env` and set `VITE_API_BASE_URL` if needed.
3. Start development: `npm run dev`
4. Create deployment files: `npm run build`

## API behaviour

- Precise permission granted: `POST /api/location` with `{ "latitude", "longitude" }`.
- Precise permission denied: `POST /api/location/fallback` with no body. This uses the request IP on the Spring backend, as required by the supplied controller.
- For a production deployment on a different domain, set `VITE_API_BASE_URL` to the public Spring backend URL (and allow the frontend origin in backend CORS).

## GitHub Pages deployment

This repository includes `.github/workflows/deploy-pages.yml`. Push it to the `master` branch, then open **Settings → Pages** in GitHub and choose **GitHub Actions** as the source. Add a repository variable called `VITE_API_BASE_URL` with your public Spring backend URL, for example `https://locationfinder-pdzb.onrender.com`.

The Spring backend must allow your GitHub Pages origin in CORS (for example `https://YOUR_GITHUB_USERNAME.github.io`). The workflow builds from the committed `package-lock.json` and publishes `dist` automatically.

For Vercel, Netlify, or Cloudflare Pages, use build command `npm run build`, publish directory `dist`, and create the same `VITE_API_BASE_URL` environment variable.
