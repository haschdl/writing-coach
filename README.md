# Skriv — Swedish writing coach

Next.js App Router app with Fast Refresh (hot reload) on save.

## Run locally

```bash
pnpm install
cp .env.example .env.local   # optional: add OPENAI_API_KEY for live AI feedback
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Edits under `app/` and `components/` reload automatically.

`pnpm build` then `pnpm start` runs the production server.
