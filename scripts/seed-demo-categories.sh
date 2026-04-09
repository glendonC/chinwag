#!/bin/bash
# Seed demo memory categories and categorized memories into a local chinwag instance.
# Usage: ./scripts/seed-demo-categories.sh <team_id> <token>
#
# Requires a running wrangler dev server (cd packages/worker && npx wrangler dev)
# and an authenticated user. Get your token from ~/.chinwag/config.json or browser devtools.

set -euo pipefail

API="${CHINWAG_API:-http://localhost:8787}"
TEAM_ID="${1:?Usage: $0 <team_id> <token>}"
TOKEN="${2:?Usage: $0 <team_id> <token>}"

AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

echo "Seeding demo data into team $TEAM_ID at $API"

# --- Create categories ---

echo "Creating categories..."

curl -s -X POST "$API/teams/$TEAM_ID/categories" \
  -H "$AUTH" -H "$CT" \
  -d '{"name":"architecture","description":"System design decisions, patterns, and structural choices","color":"#6366f1"}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/categories" \
  -H "$AUTH" -H "$CT" \
  -d '{"name":"security","description":"Authentication, authorization, vulnerability fixes, threat model decisions","color":"#ef4444"}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/categories" \
  -H "$AUTH" -H "$CT" \
  -d '{"name":"setup","description":"Environment setup, configuration, tooling, build pipeline","color":"#22c55e"}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/categories" \
  -H "$AUTH" -H "$CT" \
  -d '{"name":"conventions","description":"Code style, naming patterns, file organization standards","color":"#f59e0b"}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/categories" \
  -H "$AUTH" -H "$CT" \
  -d '{"name":"gotchas","description":"Non-obvious behaviors, footguns, things that tripped us up","color":"#ec4899"}' | jq .

# --- Save categorized memories ---

echo "Saving memories..."

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"SQLite on Durable Objects has no native vector operations. Use brute-force cosine similarity in JS for small corpora (<5k entries). Store embeddings as BLOBs.","tags":["sqlite","embeddings"],"categories":["architecture","gotchas"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"All AI moderation uses Llama Guard 3 via env.AI binding. No external API keys needed. Blocklist runs first (sync), AI runs second (async).","tags":["moderation","cloudflare"],"categories":["architecture"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"Every read endpoint must verify the caller has access. Never assume the URL is proof of authorization. Unauthenticated reads are bugs.","tags":["auth"],"categories":["security"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"Access tokens use 90-day sliding window TTL. Every auth re-PUTs the KV entry. Web sessions get 30 days. Refresh tokens last 180 days.","tags":["tokens","auth"],"categories":["security","conventions"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"Run npx wrangler dev in packages/worker for local dev. The CLI is cd packages/cli && npm run dev. Web is npm run dev in packages/web.","tags":["dev-server"],"categories":["setup"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"MCP server must never use console.log — stdio transport uses stdout for JSON-RPC. Use console.error for all logging.","tags":["mcp"],"categories":["gotchas","conventions"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"DO methods return {ok:true} or {error:string}. Route handlers check .error and return HTTP status. Throws are for unexpected failures only.","tags":["patterns"],"categories":["conventions"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"Memory cap raised to 2000. Pruning is decay-aware: last_accessed_at DESC, then updated_at DESC, then created_at DESC. Unused memories evict first.","tags":["memory","lifecycle"],"categories":["architecture"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"Node 22+ required for CLI — native WebSocket support. Built with esbuild to dist/cli.js. Entry point is cli.jsx.","tags":["cli","node"],"categories":["setup"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"Rate limits: 20 memory saves/day, 50 updates/day, 50 deletes/day per user. Categories: 50/day. Enforced at route layer via withTeamRateLimit.","tags":["rate-limits"],"categories":["security","conventions"]}' | jq .

# --- Uncategorized memories (to show the tag-only experience) ---

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"12-color palette for user identity: red, cyan, yellow, green, magenta, blue, orange, lime, pink, sky, lavender, white.","tags":["design","colors"]}' | jq .

curl -s -X POST "$API/teams/$TEAM_ID/memory" \
  -H "$AUTH" -H "$CT" \
  -d '{"text":"Handle format: 3-20 chars, alphanumeric + underscores, globally unique across all teams.","tags":["validation"]}' | jq .

echo ""
echo "Done! Seeded 5 categories and 12 memories."
echo "Visit the dashboard to see them in the Memory tab."
