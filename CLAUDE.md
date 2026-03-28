# Open Brain

## What This Is
Nicole's personal knowledge database — Postgres + pgvector on Supabase, connected to Claude Code (and any MCP-compatible AI) via a single Edge Function. Semantic search across all captured thoughts, decisions, feedback, and project context.

## Architecture
```
Claude Code / ChatGPT / any MCP client
    → Supabase Edge Function (Deno, Hono, MCP protocol)
        → OpenRouter: text-embedding-3-small (1536-dim vectors)
        → OpenRouter: gpt-4o-mini (metadata extraction)
        → Supabase PostgreSQL + pgvector (thoughts table)
```

## Metadata Schema (Nicole-specific)
Every thought gets auto-extracted metadata:
- `type`: session | decision | feedback | skill | agent | insight | reference | person_note | project_state | task
- `project`: blobfx | jobhunt | jobops | global
- `topics`: ["audio", "shader", "ios", "mobile", "p5js", "mediapipe", ...]
- `people`: ["@pbltrr", ...]
- `action_items`: implied to-dos
- `status`: active | resolved | uncommitted | blocked
- `files`: ["blob-core.js", ...]
- `commit`: git SHA if mentioned
- `severity`: critical | high | medium | low
- `source`: mcp | claude-code | slack | migration

## MCP Tools
| Tool | Purpose |
|------|---------|
| `capture_thought` | Save with auto-embedding + metadata extraction |
| `search_thoughts` | Semantic search with project/type filters |
| `list_thoughts` | Chronological list with metadata filters |
| `thought_stats` | Totals, types, projects, topics, people |
| `open_items` | Unresolved work across all projects |
| `update_thought` | Update content by ID (re-embeds + re-extracts metadata) |
| `delete_thought` | Permanently delete a thought by ID |

## SQL Views
- `open_items` — uncommitted/active/blocked + action items
- `decisions` — all architectural decisions
- `skills` — all learned capabilities/techniques
- `lessons` — all feedback/learned lessons
- `this_week` — activity summary by type and project
- `stale_items` — >14 days old, still marked active

## Files
- `supabase/schema.sql` — database schema + views
- `supabase/functions/open-brain-mcp/index.ts` — Edge Function (7 MCP tools)
- `scripts/first-20-captures.jsonl` — initial seed data from existing projects
- `scripts/migrate.sh` — seed runner
- `setup.sh` — full setup automation

## Setup
```bash
chmod +x setup.sh && ./setup.sh
```
Needs: Supabase account (free tier), OpenRouter API key (~$0.10-0.30/month).

## Capture Habit
Log these daily from Claude Code or Slack:
- **Decisions**: "Decision: [what]. Because [why]. Rejected [alternatives]."
- **Lessons**: "Learned: [rule]. Because [incident]. Applies when [context]."
- **Session end**: "Session: [what I did]. Committed [hash]. Status: [done/uncommitted]."
- **Blockers**: "Blocked: [what] on [why]. Need [resolution]."
- **People**: "[Name] — [context]. [Relevant detail for future interactions]."
