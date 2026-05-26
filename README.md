# OMNIRAT — track.js API

[![Stars](https://img.shields.io/github/stars/OWNER/REPO?style=social)](https://github.com/OWNER/REPO/stargazers) [![Forks](https://img.shields.io/github/forks/OWNER/REPO?style=social)](https://github.com/OWNER/REPO/network/members) [![Deploy Vercel](https://img.shields.io/badge/deploy-vercel-black)](https://vercel.com)

A minimal guide to host and run the serverless endpoint `api/track.js`.

## Quick Hosting (recommended)

- 1) Push this repository to GitHub (or your Git provider).
- 2) Import the repo into Vercel (https://vercel.com) and deploy.
- 3) Ensure the file `api/track.js` remains at the project root under the `api/` folder.
- 4) (Optional) Add any required environment variables in the Vercel dashboard.

After deployment the endpoint will be available at:

```
https://<your-deployment>.vercel.app/api/track
```

## Local testing

Install Vercel CLI and run the dev server:

```bash
npm i -g vercel
vercel dev
```

Then test the endpoint with curl (example POST):

```bash
curl -X POST https://localhost:3000/api/track -H "Content-Type: application/json" \
  -d '{"example":"payload"}'
```

Or test the deployed URL:

```bash
curl -X POST https://<your-deployment>.vercel.app/api/track -H "Content-Type: application/json" \
  -d '{"example":"payload"}'
```

## Notes

- Replace `OWNER/REPO` in the badges above with your GitHub owner and repository name to show real Stars/Forks counts.
- This repository already includes `vercel.json` and the `api/track.js` function — Vercel will detect and deploy it as a serverless function.

If you want, I can replace the badge placeholders with your GitHub repo details and add a CI/deploy badge.
