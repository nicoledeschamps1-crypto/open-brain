The project is Open Brain, a Postgres+pgvector knowledge database with a Basecamp-style web dashboard.

## About Open Brain

- **Stack**: Supabase (Postgres + pgvector), Edge Functions (Deno), single `brain.html` dashboard
- **MCP Server**: 7 tools (capture, search, list, stats, open_items, update, delete) — registered via `server.registerTool()` + Zod schema + Supabase query
- **Dashboard**: `brain.html` — HQ page + project pages + type pads + edit/delete + Skills section
- **Metadata types**: session, decision, feedback, skill, insight, reference, person_note, project_state, task
- **Supabase project**: `liiufrjsesepgsaqtlka` (free tier)
- **Deploy**: `supabase functions deploy` for edge functions, `db query --linked` for SQL migrations

## Hard Constraints (DO NOTs)

- Single HTML file for dashboard (no build step, no bundler)
- CORS headers required on ALL error paths in edge functions
- SSE `data:` line parsing must handle multi-line content
- ID `[id:UUID]` must propagate through all text parsing regex
- SQL views must reference only columns that exist in production
- Never swallow JS errors with empty try/catch — surface them in UI
- Free tier limits: 500MB database, 2M edge function invocations/month
