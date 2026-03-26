#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Open Brain — Setup Script
# Run this after creating a Supabase project
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

echo "═══ Open Brain Setup ═══"
echo ""

# Step 1: Check prerequisites
echo "Step 1: Checking prerequisites..."

if ! command -v supabase &>/dev/null; then
  echo "Installing Supabase CLI..."
  brew install supabase/tap/supabase
fi

echo "  ✓ Supabase CLI: $(supabase --version)"

if ! command -v openssl &>/dev/null; then
  echo "  ✗ openssl not found"
  exit 1
fi
echo "  ✓ openssl available"
echo ""

# Step 2: Generate MCP access key
echo "Step 2: Generating MCP access key..."
MCP_KEY=$(openssl rand -hex 32)
echo "  Your MCP access key: $MCP_KEY"
echo "  ⚠️  Save this — you'll need it for Claude Code setup"
echo ""

# Step 3: Prompt for project ref and API keys
echo "Step 3: Configuration"
echo "  You need:"
echo "    1. Supabase project ref (from project URL: https://supabase.com/dashboard/project/<ref>)"
echo "    2. OpenRouter API key (from https://openrouter.ai/keys)"
echo ""
read -p "  Supabase project ref: " PROJECT_REF
read -p "  OpenRouter API key: " OPENROUTER_KEY
echo ""

# Step 4: Initialize and link Supabase
echo "Step 4: Linking Supabase project..."
cd "$(dirname "$0")"

if [ ! -f supabase/config.toml ]; then
  supabase init
fi

supabase link --project-ref "$PROJECT_REF"
echo "  ✓ Linked to project $PROJECT_REF"
echo ""

# Step 5: Set secrets
echo "Step 5: Setting Edge Function secrets..."
supabase secrets set "MCP_ACCESS_KEY=$MCP_KEY"
supabase secrets set "OPENROUTER_API_KEY=$OPENROUTER_KEY"
echo "  ✓ Secrets configured"
echo ""

# Step 6: Deploy
echo "Step 6: Deploying Edge Function..."
supabase functions deploy open-brain-mcp --no-verify-jwt
echo "  ✓ Function deployed"
echo ""

# Step 7: Show connection info
FUNCTION_URL="https://${PROJECT_REF}.supabase.co/functions/v1/open-brain-mcp"
echo "═══ Setup Complete ═══"
echo ""
echo "Your Open Brain MCP endpoint:"
echo "  $FUNCTION_URL"
echo ""
echo "Connect to Claude Code:"
echo "  claude mcp add --transport http open-brain \\"
echo "    $FUNCTION_URL \\"
echo "    --header \"x-brain-key: $MCP_KEY\""
echo ""
echo "Next steps:"
echo "  1. Run the SQL schema in Supabase SQL Editor:"
echo "     cat supabase/schema.sql | pbcopy"
echo "     Then paste in: https://supabase.com/dashboard/project/$PROJECT_REF/sql/new"
echo ""
echo "  2. Run the migration to seed your first 20 captures:"
echo "     BRAIN_URL=$FUNCTION_URL BRAIN_KEY=$MCP_KEY bash scripts/migrate.sh"
echo ""
echo "  3. Test from Claude Code:"
echo "     Ask: 'Search my Open Brain for iOS Safari lessons'"
echo ""

# Save config for later use
cat > .env <<EOF
SUPABASE_PROJECT_REF=$PROJECT_REF
BRAIN_URL=$FUNCTION_URL
BRAIN_KEY=$MCP_KEY
OPENROUTER_API_KEY=$OPENROUTER_KEY
EOF

echo "Config saved to .env (gitignored)"
