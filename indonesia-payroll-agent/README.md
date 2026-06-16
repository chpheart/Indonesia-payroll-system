# Indonesia Payroll Agent

Internal payroll delivery system for Indonesia payroll runs.

Phase 1 currently covers backend project infrastructure only:

- Next.js App Router project scaffold.
- TypeScript strict mode, ESLint, Vitest and Playwright installed.
- PostgreSQL 18 local Docker Compose service definition.
- Prisma 7.8.0 config and generated client.
- `/api/health` route with database probe.
- Local file storage adapter.

Frontend pages, navigation shell and dashboard UI are intentionally skipped for now.

## Commands

```bash
pnpm install
pnpm prisma:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Start local Postgres when Docker Hub access is available:

```bash
docker compose up -d postgres
pnpm db:push
```

The local Postgres service maps container port 5432 to host port 5433 to avoid
colliding with an existing Postgres on the host machine.

Run the app locally:

```bash
pnpm dev
```
