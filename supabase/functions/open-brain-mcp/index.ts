import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ═══ Embedding & Metadata ═══

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

// Nicole-specific metadata extraction — tuned for her workflow
async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from a developer's captured thought. Return JSON with:
- "type": one of "session", "decision", "feedback", "insight", "reference", "person_note", "project_state", "task"
- "project": one of "blobfx", "jobhunt", "jobops", "global", or null if unclear
- "topics": array of 1-4 short tags (e.g. "audio", "shader", "ios", "mobile", "p5js", "mediapipe", "timeline", "ui", "architecture")
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "status": one of "active", "resolved", "uncommitted", "blocked", null if not applicable
- "files": array of file references mentioned (e.g. "blob-core.js", "match_scorer.py") — empty if none
- "commit": git SHA if mentioned, null otherwise
- "severity": one of "critical", "high", "medium", "low", null if not a bug/issue
Only extract what's explicitly stated. Prefer specific tags over generic ones.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "insight" };
  }
}

// ═══ MCP Server ═══

const server = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

// Tool 1: Semantic Search
server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use when the user asks about a topic, decision, lesson, or person they've previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.5),
      project: z.string().optional().describe("Filter by project: blobfx, jobhunt, jobops, global"),
      type: z.string().optional().describe("Filter by type: session, decision, feedback, insight, reference, person_note, project_state, task"),
    },
  },
  async ({ query, limit, threshold, project, type }) => {
    try {
      const qEmb = await getEmbedding(query);
      const filter: Record<string, unknown> = {};
      if (project) filter.project = project;
      if (type) filter.type = type;

      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        filter: Object.keys(filter).length ? filter : {},
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
        };
      }

      const results = data.map(
        (t: { content: string; metadata: Record<string, unknown>; similarity: number; created_at: string }, i: number) => {
          const m = t.metadata || {};
          const parts = [
            `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
            `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
            `Type: ${m.type || "unknown"} | Project: ${m.project || "?"}`,
          ];
          if (Array.isArray(m.topics) && m.topics.length)
            parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
          if (m.status) parts.push(`Status: ${m.status}`);
          if (Array.isArray(m.files) && m.files.length)
            parts.push(`Files: ${(m.files as string[]).join(", ")}`);
          if (m.commit) parts.push(`Commit: ${m.commit}`);
          if (Array.isArray(m.people) && m.people.length)
            parts.push(`People: ${(m.people as string[]).join(", ")}`);
          if (Array.isArray(m.action_items) && m.action_items.length)
            parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
          parts.push(`\n${t.content}`);
          return parts.join("\n");
        }
      );

      return {
        content: [{
          type: "text" as const,
          text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}`,
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: List Recent
server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts with filters by type, project, topic, status, or time range.",
    inputSchema: {
      limit: z.number().optional().default(10),
      type: z.string().optional().describe("Filter by type"),
      project: z.string().optional().describe("Filter by project"),
      topic: z.string().optional().describe("Filter by topic tag"),
      status: z.string().optional().describe("Filter by status: active, resolved, uncommitted, blocked"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    },
  },
  async ({ limit, type, project, topic, status, days }) => {
    try {
      let q = supabase
        .from("thoughts")
        .select("content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (type) q = q.contains("metadata", { type });
      if (project) q = q.contains("metadata", { project });
      if (topic) q = q.contains("metadata", { topics: [topic] });
      if (status) q = q.contains("metadata", { status });
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }

      const { data, error } = await q;

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      }

      const results = data.map(
        (t: { content: string; metadata: Record<string, unknown>; created_at: string }, i: number) => {
          const m = t.metadata || {};
          const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
          const proj = m.project ? `[${m.project}]` : "";
          return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] ${proj} (${m.type || "??"}${tags ? " — " + tags : ""})\n   ${t.content.slice(0, 200)}${t.content.length > 200 ? "..." : ""}`;
        }
      );

      return {
        content: [{
          type: "text" as const,
          text: `${data.length} thought(s):\n\n${results.join("\n\n")}`,
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: Capture Thought
server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a thought to the Open Brain. Embeds and extracts metadata automatically. Use for decisions, lessons, insights, session notes, or anything worth remembering across conversations.",
    inputSchema: {
      content: z.string().describe("The thought — a clear, standalone statement"),
      project: z.string().optional().describe("Override project: blobfx, jobhunt, jobops, global"),
      type: z.string().optional().describe("Override type: session, decision, feedback, insight, reference, person_note, project_state, task"),
    },
  },
  async ({ content, project, type }) => {
    try {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(content),
        extractMetadata(content),
      ]);

      // Apply overrides
      if (project) metadata.project = project;
      if (type) metadata.type = type;
      metadata.source = "mcp";

      const { error } = await supabase.from("thoughts").insert({
        content,
        embedding,
        metadata,
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }],
          isError: true,
        };
      }

      const meta = metadata as Record<string, unknown>;
      let confirmation = `Captured as ${meta.type || "thought"}`;
      if (meta.project) confirmation += ` [${meta.project}]`;
      if (Array.isArray(meta.topics) && meta.topics.length)
        confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
      if (Array.isArray(meta.action_items) && meta.action_items.length)
        confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;

      return {
        content: [{ type: "text" as const, text: confirmation }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: Stats
server.registerTool(
  "thought_stats",
  {
    title: "Brain Stats",
    description: "Summary of all captured thoughts: totals, types, projects, top topics, people.",
    inputSchema: {},
  },
  async () => {
    try {
      const { count } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });

      const { data } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false });

      const types: Record<string, number> = {};
      const projects: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};
      const statuses: Record<string, number> = {};

      for (const r of data || []) {
        const m = (r.metadata || {}) as Record<string, unknown>;
        if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
        if (m.project) projects[m.project as string] = (projects[m.project as string] || 0) + 1;
        if (m.status) statuses[m.status as string] = (statuses[m.status as string] || 0) + 1;
        if (Array.isArray(m.topics))
          for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
        if (Array.isArray(m.people))
          for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
      }

      const sort = (o: Record<string, number>): [string, number][] =>
        Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const lines: string[] = [
        `Total thoughts: ${count}`,
        `Date range: ${
          data?.length
            ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
              " → " +
              new Date(data[0].created_at).toLocaleDateString()
            : "N/A"
        }`,
        "",
        "By type:", ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
        "", "By project:", ...sort(projects).map(([k, v]) => `  ${k}: ${v}`),
        "", "By status:", ...sort(statuses).map(([k, v]) => `  ${k}: ${v}`),
      ];

      if (Object.keys(topics).length) {
        lines.push("", "Top topics:");
        for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
      }
      if (Object.keys(people).length) {
        lines.push("", "People mentioned:");
        for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 5: Open Items (Nicole-specific)
server.registerTool(
  "open_items",
  {
    title: "Open Items",
    description: "Show unresolved items: uncommitted work, active bugs, blocked tasks, pending action items across all projects.",
    inputSchema: {
      project: z.string().optional().describe("Filter by project"),
    },
  },
  async ({ project }) => {
    try {
      let q = supabase
        .from("thoughts")
        .select("content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(25);

      // Filter for open statuses OR items with action_items
      q = q.or("metadata->>status.in.(uncommitted,active,blocked),metadata->action_items.neq.[]");
      if (project) q = q.contains("metadata", { project });

      const { data, error } = await q;

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return { content: [{ type: "text" as const, text: "No open items found." }] };
      }

      const results = data.map(
        (t: { content: string; metadata: Record<string, unknown>; created_at: string }, i: number) => {
          const m = t.metadata || {};
          const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
          return `${i + 1}. [${m.project || "?"}] (${m.status || "?"}, ${age}d ago) ${m.type || ""}\n   ${t.content.slice(0, 150)}`;
        }
      );

      return {
        content: [{
          type: "text" as const,
          text: `${data.length} open item(s):\n\n${results.join("\n\n")}`,
        }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ═══ Hono App + Auth + CORS ═══

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();

app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  }

  // Patch Accept header for Claude Desktop compatibility
  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);

  // Inject CORS headers into the transport's response
  if (response instanceof Response) {
    for (const [k, v] of Object.entries(corsHeaders)) {
      response.headers.set(k, v);
    }
    return response;
  }
  return response;
});

Deno.serve(app.fetch);
