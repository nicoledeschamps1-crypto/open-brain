The project is Open Brain. Follow these patterns exactly.

## Code Patterns

### Adding MCP tools
1. `server.registerTool()` with name, description, input schema (Zod)
2. Implement handler with Supabase query
3. Return structured result matching tool contract
4. Test with `claude -p` or MCP inspector

### Adding dashboard features
1. Add entry to `TYPE_MAP` for new metadata types
2. Add nav tab in the tab bar section
3. Add HQ pad/card in the HQ grid
4. Use CSS custom properties for theming
5. All content in single `brain.html` file

### SQL migrations
1. Write migration SQL
2. Test locally: `~/bin/supabase db query --linked < migration.sql`
3. Verify with `~/bin/supabase db query --linked "SELECT * FROM ..."`

### Deploy steps
1. `~/bin/supabase functions deploy --linked` for edge functions
2. `~/bin/supabase db query --linked` for SQL
3. No cache busting needed (single HTML file served directly)

## After Building

No file sync needed — Open Brain is a single `brain.html` plus Supabase backend. Just verify the local server shows changes.
