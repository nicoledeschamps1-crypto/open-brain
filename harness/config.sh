#!/bin/bash
# Harness config for: Open Brain (Knowledge DB + Dashboard)

PROJECT_NAME="Open Brain"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$PROJECT_DIR/sprint-contracts"
SERVER_PORT=8090

# URLs
HEALTH_CHECK_URL="http://localhost:$SERVER_PORT/brain.html"
EVAL_URL="http://localhost:$SERVER_PORT/brain.html"

# Budget
MAX_FIX_ROUNDS=3
MAX_BUDGET_PER_PHASE=25

# --- Hook Functions ---

# No file sync needed — single HTML file
post_build_hook() {
  :
}

# Deploy: push Supabase functions + git commit
deploy_hook() {
  cd "$PROJECT_DIR"

  # Deploy edge functions if any changed
  if [[ -d "$PROJECT_DIR/supabase/functions" ]]; then
    log "Deploying Supabase edge functions..."
    ~/bin/supabase functions deploy --linked 2>/dev/null || warn "Function deploy failed (non-fatal)"
  fi

  git add -A
  git commit -m "feat: $FEATURE_NAME (harness-built, $(date +%Y-%m-%d))"
  ok "Committed"
}
