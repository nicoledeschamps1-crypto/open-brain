#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Open Brain — Migration Script
# Seeds the database with First 20 Captures via the MCP server
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

BRAIN_URL="${BRAIN_URL:?Set BRAIN_URL to your Supabase Edge Function URL}"
BRAIN_KEY="${BRAIN_KEY:?Set BRAIN_KEY to your MCP access key}"

CAPTURES_FILE="$(dirname "$0")/first-20-captures.jsonl"

if [ ! -f "$CAPTURES_FILE" ]; then
  echo "Error: $CAPTURES_FILE not found"
  exit 1
fi

echo "Migrating First 20 Captures to Open Brain..."
echo "URL: $BRAIN_URL"
echo ""

COUNT=0
TOTAL=$(wc -l < "$CAPTURES_FILE" | tr -d ' ')

while IFS= read -r line; do
  COUNT=$((COUNT + 1))

  CONTENT=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['content'])")
  TYPE=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('type',''))" 2>/dev/null || echo "")
  PROJECT=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('project',''))" 2>/dev/null || echo "")

  # Build MCP JSON-RPC request for capture_thought
  ARGS="{\"content\": $(echo "$CONTENT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")}"
  if [ -n "$TYPE" ]; then
    ARGS=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); d['type']='$TYPE'; print(json.dumps(d))")
  fi
  if [ -n "$PROJECT" ]; then
    ARGS=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); d['project']='$PROJECT'; print(json.dumps(d))")
  fi

  PAYLOAD=$(cat <<EOJSON
{
  "jsonrpc": "2.0",
  "id": $COUNT,
  "method": "tools/call",
  "params": {
    "name": "capture_thought",
    "arguments": $ARGS
  }
}
EOJSON
)

  echo "[$COUNT/$TOTAL] Capturing: ${CONTENT:0:60}..."

  RESPONSE=$(curl -s -X POST "$BRAIN_URL" \
    -H "Content-Type: application/json" \
    -H "x-brain-key: $BRAIN_KEY" \
    -H "Accept: application/json, text/event-stream" \
    -d "$PAYLOAD")

  # Check for errors
  if echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if 'error' not in d else 1)" 2>/dev/null; then
    echo "  ✓ Done"
  else
    echo "  ✗ Error: $RESPONSE"
  fi

  # Rate limit — avoid hammering OpenRouter
  sleep 1
done < "$CAPTURES_FILE"

echo ""
echo "Migration complete: $COUNT captures processed."
echo "Run 'thought_stats' via MCP to verify."
