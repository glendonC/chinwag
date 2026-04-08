#!/bin/bash
# Fix miscategorized tools in the directory.
# Usage: ADMIN_KEY=your_exa_api_key bash scripts/fix-categories.sh
#
# This patches existing evaluations via the admin-import endpoint.
# No Exa calls — just updates the category field in the DB.

API="https://chinwag-api.glendonchin.workers.dev"

if [ -z "$ADMIN_KEY" ]; then
  echo "Error: ADMIN_KEY env var required (your EXA_API_KEY)"
  exit 1
fi

# Map of tool_id → correct_category
# Only fixing tools that are clearly miscategorized as "other"
declare -A FIXES=(
  # Should be coding-agent (AI coding tools)
  ["codegeex"]="coding-agent"
  ["supermaven"]="coding-agent"
  ["onecompiler"]="coding-agent"
  ["bugstack"]="coding-agent"
  ["jit-ai-code-playground"]="coding-agent"
  ["crystal"]="coding-agent"

  # Should be ide (IDE extensions / code assistants in editors)
  ["phind"]="ide"
  ["pieces"]="ide"
  ["pieces-for-developers"]="ide"

  # Should be terminal (CLI tools)
  ["deepl-cli"]="terminal"
  ["ctxlint"]="terminal"

  # Should be image-gen (image/art generation) — NEW CATEGORY
  ["midjourney"]="image-gen"
  ["deep-art-effects"]="image-gen"
  ["scribble-diffusion"]="image-gen"

  # Should be ai-assistant (general AI assistants) — NEW CATEGORY
  ["jasper"]="ai-assistant"
  ["jenni-ai"]="ai-assistant"
  ["autoregex"]="ai-assistant"
  ["textcraft"]="ai-assistant"
  ["contextwire"]="ai-assistant"

  # Should be devops — NEW CATEGORY
  ["omniroute"]="devops"
  ["you-com-mcp-server"]="devops"

  # Should be docs (documentation / knowledge tools)
  ["memex"]="docs"
  ["memory-crystal"]="docs"
  ["mantra"]="docs"

  # Should be review (code review / architecture)
  ["bito-ai-architect"]="review"
  ["rule-porter"]="review"

  # Should be design-to-code
  ["enigmaeasel"]="design-to-code"

  # Should be infrastructure — NEW CATEGORY
  ["unpkg-ai"]="infrastructure"
  ["trellis"]="infrastructure"
  ["cchub"]="infrastructure"

  # Garbage entries that shouldn't be in a dev tool directory — these are books/journals/travel apps
  # We'll leave them as "other" for now but they should be deleted via admin-delete
)

# Tools to DELETE (not dev tools, duplicates, or garbage)
DELETIONS=(
  # Not dev tools
  "data-science-from-scratch"          # Book, not a tool
  "deep-learning-with-python"          # Book, not a tool
  "international-journal-of-machine-learning-and-cybernetics"  # Academic journal
  "roamaround-io"                      # Travel planner, not a dev tool
  "promoai"                            # Video marketing tool
  "vizologi"                           # Business plan generator
  "ai-for-biz"                         # Business tool, not dev
  "flydex"                             # Unknown/no description
  "chatwithgit"                        # Unknown/no description
  "code-chatgpt-plugin"               # Deprecated ChatGPT plugin
  # Duplicates
  "windsurf-formerly-codeium"          # Duplicate of windsurf
  "windsurf-editor"                    # Duplicate of windsurf
  "pieces"                             # Duplicate of pieces-for-developers (less specific name)
)

echo "=== Fixing categories ==="
echo ""

# Fetch current evaluations for the tools we're fixing
for tool_id in "${!FIXES[@]}"; do
  new_cat="${FIXES[$tool_id]}"
  echo "  $tool_id → $new_cat"

  # Fetch current evaluation
  eval_json=$(curl -s "$API/tools/directory/$tool_id")
  has_eval=$(echo "$eval_json" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d.get('evaluation') else 'no')" 2>/dev/null)

  if [ "$has_eval" != "yes" ]; then
    echo "    ⚠ Not found, skipping"
    continue
  fi

  # Patch category via admin-import (upsert)
  patched=$(echo "$eval_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
ev = data['evaluation']
ev['category'] = '$new_cat'
print(json.dumps({'admin_key': '$ADMIN_KEY', 'evaluations': [ev]}))
" 2>/dev/null)

  result=$(curl -s -X POST "$API/tools/admin-import" \
    -H "Content-Type: application/json" \
    -d "$patched")

  saved=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('saved', 0))" 2>/dev/null)
  if [ "$saved" = "1" ]; then
    echo "    ✓ Updated"
  else
    echo "    ✗ Failed: $result"
  fi
done

echo ""
echo "=== Deleting non-dev-tool entries ==="
echo ""

if [ ${#DELETIONS[@]} -gt 0 ]; then
  ids_json=$(python3 -c "
import json
ids = $(printf "'%s'," "${DELETIONS[@]}" | sed 's/,$//')
print(json.dumps({'admin_key': '$ADMIN_KEY', 'ids': [$(printf '"%s",' "${DELETIONS[@]}" | sed 's/,$//')]}))
" 2>/dev/null)

  result=$(curl -s -X POST "$API/tools/admin-delete" \
    -H "Content-Type: application/json" \
    -d "$ids_json")

  echo "  Delete result: $result"
fi

echo ""
echo "=== Done ==="
echo ""
echo "Next: run icon backfill (no Exa needed):"
echo "  curl -X POST $API/tools/batch-resolve-icons -H 'Content-Type: application/json' -d '{\"admin_key\":\"YOUR_KEY\",\"limit\":50}'"
