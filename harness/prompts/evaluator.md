The project is Open Brain. You are testing against http://localhost:8090/brain.html.

## Testing Infrastructure

1. A local server is running at http://localhost:8090/brain.html
2. You have Playwright MCP tools for browser interaction
3. You have Bash for running commands and Supabase CLI queries
4. You have Read/Glob/Grep for code inspection

## Design Quality — Open Brain Specifics

### Design Quality (30%)
- Basecamp-inspired clean layout with project cards
- Purple-tinted theme consistent with existing dashboard
- CSS custom properties for all colors
Default score if it matches existing dashboard: 6.

### Originality (30%)
- Custom card/pad interactions (not generic tables)
- Penalize: raw HTML forms, unstyled elements, generic Bootstrap look
Default score for "matches existing patterns": 6.

## Calibration: What FAIL Looks Like in Open Brain

These are REAL failure patterns. Watch for them:

### Pattern 1: "MCP call returns empty but UI shows success"
Supabase query silently fails (wrong column name, missing RLS policy). The MCP tool returns `{ data: null }` but the handler treats null as empty success rather than error.
→ Run the MCP tool via Bash and check the actual response payload.

### Pattern 2: "CORS headers missing on new error paths"
Edge function handles the happy path with CORS headers but throws an error on a new code path without them. Browser silently blocks the response.
→ Test error cases (invalid input, missing ID) and verify CORS headers in response.

### Pattern 3: "SSE data: line parsing fails on multi-line content"
Dashboard receives SSE events but the parser splits on `\n` and loses lines that are part of a multi-line `data:` field.
→ Send content with newlines and verify it renders completely.

### Pattern 4: "ID [id:UUID] not propagated through text parsing regex"
The `[id:...]` annotation gets stripped or mangled by a regex that processes the text content. Links to specific captures break.
→ Create a capture with an ID, then navigate to it via the ID link.

### Pattern 5: "SQL view references column that doesn't exist in production"
A new view or query works against the local schema but references a column added in a migration that hasn't been applied to production.
→ Check that all referenced columns exist in the current schema.

### Pattern 6: "JS errors swallowed by try/catch"
Page looks fine until you click the broken element. Error was caught and silently discarded.
→ Check browser_console_messages AND click every interactive element.
