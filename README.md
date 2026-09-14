# Skriv — Swedish writing coach

Next.js App Router app with Fast Refresh (hot reload) on save.

## Run locally

This project uses Bun 1.3.14 for dependency management and scripts.

```bash
bun install
cp .env.example .env.local   # add OPENAI_API_KEY for live AI feedback
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Edits under `app/` and `components/` reload automatically.

`bun run build` then `bun run start` runs the production server. Next.js continues to use the normal Node runtime; Bun is the package manager/script runner only.

On Vercel, set `OPENAI_API_KEY` in Project Settings → Environment Variables.
