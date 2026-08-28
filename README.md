# Skriv — Swedish writing coach

Next.js App Router app with Fast Refresh (hot reload) on save.

## Run locally

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY for live AI feedback
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Edits under `app/` and `components/` reload automatically.

`npm run build` then `npm start` runs the production server.

On Vercel, set `OPENAI_API_KEY` in Project Settings → Environment Variables.
