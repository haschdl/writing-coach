# Skriv — Swedish writing coach

Next.js App Router app with Fast Refresh (hot reload) on save.

Uses [Bun 1](https://bun.sh) as the package manager. Vercel detects `bun.lock` and runs `bun install` automatically ([package managers](https://vercel.com/docs/package-managers)).

## Run locally

```bash
bun install
cp .env.example .env.local   # add OPENAI_API_KEY for live AI feedback
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Edits under `app/` and `components/` reload automatically.

`bun run build` then `bun run start` runs the production server.

On Vercel, set `OPENAI_API_KEY` in Project Settings → Environment Variables.
