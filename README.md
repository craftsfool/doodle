<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/efd29477-2959-42a3-b3e1-a1a437c977b7

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Doodle Archive

The Doodle gallery is archived into `public/doodles` so Vercel does not need to fetch Google on every visitor request.

- `npm run doodles:update` fetches recent Google Doodles, downloads images, writes `public/doodles/manifest.json`, and regenerates `doodleArchive.ts`.
- `.github/workflows/update-doodles.yml` runs that script daily on GitHub Actions and commits any archive changes back to `main`.
- You can also run the workflow manually from GitHub Actions with **Update Doodle Archive -> Run workflow**.
