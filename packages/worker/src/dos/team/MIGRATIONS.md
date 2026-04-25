# TeamDO Migration Intent Log

This document records the WHY behind each migration in `schema.ts`. The schema
file is the authoritative source for the SQL itself; this file exists so a
future reader can understand what feature, bug, or constraint motivated each
ALTER without grepping git blame.

How to update this file: when you add a new migration to `schema.ts`, add a
matching section here in the same commit. Source the WHY from the PR
description or the in-progress feature work that drove the change. Do not
write the entry after the fact, and do not let the schema and this log drift
out of sync. Each entry should lead with the motivation; the schema speaks to
the what.

## 001_initial_schema

Establishes the original TeamDO tables: `members`, `activities`, `memories`,
`sessions`, `locks`, `messages`, `telemetry`, plus the first batch of indexes.

This migration is the snapshot of the pre-versioning schema at the moment the
versioned migration framework landed (commit `58c403e5`). Before that, schema
state was managed ad-hoc through `ensureSchema` plus a `reconcileLegacySchema`
pass; this entry codifies the baseline so every fresh DO arrives at the same
starting point.

## 002_reconcile_legacy

Renames pre-versioning column names and adds host-tool, agent-surface,
transport, and model columns to the existing tables, with backfill from
whatever the older column was called.

When the versioned framework landed, production DOs were already running with
older schemas (`owner_handle` instead of `handle`, `tool` instead of
`host_tool`, `source_agent` / `from_agent` instead of `agent_id`). This
migration is irreversible by design and idempotent: it uses helpers that skip
when the new column already exists, so DOs created from `001` directly are
unaffected. Do not extend this migration; new columns should land in their own
numbered migration.

## 003_additional_indexes

Adds compound indexes for active-session lookup, file-level conflict
detection, activity queries, memory pruning, member heartbeat sweeps, owner
lookups, and per-agent message inboxes.

Shipped alongside route bounds and metric centralization (commit `2e9b1576`)
when context queries started showing up as the dominant cost in DO CPU
budgets. Pure index work, safe to run repeatedly.

## 004_commands_table

Adds the `commands` table for cross-agent command relay (web spawn, status
nudges, eventual remote actions) with a `(status, created_at)` index so
pending-command sweeps stay cheap.

Landed with MCP `clientInfo`-based agent detection and the web spawn controls
(commit `c1969454`). Commands are the relay primitive that lets a non-agent
surface (web dashboard, another agent) push work into a session.

## 005_intelligence_foundation

Adds `outcome`, `outcome_summary`, `lines_added`, `lines_removed` to
`sessions` and creates `daily_metrics` for time-bucketed telemetry.

This is the seed migration for the workflow intelligence layer (commit
`78531ad8`). Outcome and diff stats are the minimum signals needed before any
of the analytics rollups (completion rate, edit velocity, period comparison)
can return useful numbers. Every later analytics column builds on this base.

## 006_memory_categories

Adds the `memory_categories` table with precomputed bge-small-en-v1.5
embeddings, a `categories` JSON column on `memories`, a `tag_stats` table for
tag-to-category promotion, and `last_accessed_at` on `memories` for lifecycle.

Part of the memory rebuild (commit `549be81e`) that introduced FTS5, dedup,
and richer query filters. Categories are admin-defined and agent-assigned at
save time; the embedding column is staged here so future semantic matching
and dedup validation can happen without another migration.

## 007_edit_log

Adds the `edits` table with per-edit rows (session, agent, file, lines added
and removed) plus indexes on session, file path, and creation time.

Same memory commit (`549be81e`). Per-session counters (`edit_count`,
`lines_added`, `lines_removed`) are useful for rollups but they collapse the
detail. The `edits` table is the source of truth for per-file conflict
analysis, work-type classification, and time-to-first-edit. Subject to the
same 30-day retention as sessions; cleanup runs in `cleanup.ts`.

## 008_memory_session_and_filters

Links memories to the session that created them via `session_id` and adds
indexes on `agent_id`, `handle`, and `session_id` so memory queries can
filter cheaply.

Same memory commit (`549be81e`). The session link is what makes
"memories-saved-this-session" attribution and per-session memory analytics
possible.

## 009_memory_fts5_dedup_embedding

Adds `text_hash` (SHA-256) and `embedding` (BLOB) columns on `memories`, a
unique index on `text_hash`, an FTS5 virtual table over text and tags with
custom tokenization for snake_case and dotted paths, plus the three sync
triggers and a backfill pass.

Same memory commit (`549be81e`). Exact dedup uses the hash, near-dedup uses
the embedding, full-text search uses FTS5. The custom tokenizer
(`unicode61` with `_.` as token chars) is load-bearing: without it,
`auth_user.email` would be three tokens and snake_case identifiers would not
match cleanly. Triggers keep FTS5 in sync; if you ever rebuild the table,
re-run the backfill.

## 010_conversation_events

Adds the `conversation_events` table for parsed user and assistant messages
from managed agent sessions, with indexes on `(session_id, sequence)`,
`(agent_id, created_at)`, and `sentiment`.

Part of the analytics backbone commit (`4eaef3ac`). Conversation events are
the raw substrate for sentiment trends, message-length analysis, topic
classification, and outcome correlation. Captured by hook-aware tools (Claude
Code) via session-log parsing; `sequence` preserves order within a session.

## 011_extended_analytics_columns

Adds `first_edit_at`, `got_stuck`, `memories_searched`, `outcome_tags` on
`sessions` and `access_count` on `memories`.

Same analytics backbone commit (`4eaef3ac`). Each column unblocks one
specific aggregation: time-to-first-edit, the 15-minute heartbeat-gap
stuckness flag, per-session memory search counts, structured outcome reasons
for grouping, and memory access frequency for lifecycle decay.

## 012_token_tracking

Adds `input_tokens` and `output_tokens` to `sessions`, both nullable.

Same analytics backbone commit (`4eaef3ac`). The nullable convention is
deliberate and load-bearing: NULL means "this tool did not report tokens"
while 0 means "measured zero." Aggregations must `COALESCE(col, 0)` to avoid
mixing the two. Superseded in spirit by `017_cache_token_tracking`, which
adds the cache-token fields needed for accurate Anthropic accounting.

## 013_normalize_model_names

Backfills `agent_model` on `sessions` and `members` plus the `model:*` keys
in `telemetry`, stripping 8-digit date suffixes so `claude-sonnet-4-5-20250514`
collapses to `claude-sonnet-4-5`.

Same analytics backbone commit (`4eaef3ac`). One-time data-cleanup migration:
the canonical normalizer now runs at write time, this entry exists only to
fix already-stored rows. The pattern match is conservative (requires a `-`
followed by 8 digits parsed as an integer greater than 20200000) so unrelated
model-name suffixes are not mangled.

## 014_tool_calls

Creates the `tool_calls` table (autoincrement id, session, agent, tool,
called_at) with indexes on `(session_id, called_at)` and `(tool, created_at)`.

Landed with MCP middleware-based tool capture and the surgical Read hook
(commit `d680d3bf`). This is the minimum viable schema for tool call capture;
`015_tool_calls_enrich` is the immediate follow-up that adds error and
duration data.

## 015_tool_calls_enrich

Adds `is_error`, `error_preview`, `input_preview`, and `duration_ms` columns
to `tool_calls`.

Shipped same day as `014` (commit `60e6c271`) once the Claude Code tool-call
log parser was ready to extract paired `tool_use` and `tool_result` events
with full error and timing detail. Split from `014` because the underlying
parser landed in a separate change.

## 016_commits

Creates the `commits` table with `UNIQUE(session_id, sha)` for idempotent
ingestion plus indexes on session, sha, and created_at; adds `commit_count`
and `first_commit_at` to `sessions`.

Git attribution feature (commit `69f46af0`). Foundation for DORA metrics,
code survivability, and CI attribution. Dual ingestion path: the Claude Code
PostToolUse hook on Bash with a fast-path rejection for non-commit calls,
plus the `chinwag_report_commits` MCP tool for connected agents. The unique
constraint matters: both paths can race and the table must be safe to
re-insert into.

## 017_cache_token_tracking

Adds `cache_read_tokens` and `cache_creation_tokens` to `sessions`, both
nullable with the same NULL-vs-zero semantics as `012`.

Without these, Anthropic prompt-cached sessions (the Claude Code default)
report only `input_tokens` and `output_tokens`, which is roughly 7% of the
real volume and a materially wrong cost figure (commit `abb2b018`).
Aggregations must `COALESCE(col, 0)`. Pricing math in the analytics layer
treats these as first-class once present.

## 018_edit_work_type

Adds `work_type` to `edits` with default `'other'`.

Classify-on-write rather than re-classify on every analytics query (commit
`e2e3444e`). Existing rows default to `'other'`, which keeps `GROUP BY
work_type` queries consistent until the legacy rows age out under the
30-day retention. The classifier itself lives in `recordEdit()`.

## 019_conversation_per_message_data

Adds `input_tokens`, `output_tokens`, `cache_read_tokens`,
`cache_creation_tokens`, `model`, and `stop_reason` to `conversation_events`.

Per-message granularity unlocks burn-rate analysis, multi-model session
tracking (a session can switch between Sonnet and Haiku turns), and
cost-per-turn reporting (commit `f8ec83b8`). Mirrors the session-level token
fields but at the event level so tool-depth indicators and enriched stat
cards can run without re-deriving totals.

## 020_memory_consolidation

Adds `merged_into` and `merged_at` soft-delete pointers on `memories`, a
partial index on the merge pointer, and a `consolidation_proposals` table
recording the cosine, jaccard, and status for each proposed merge.

Adopts Graphiti's recall-then-verify funnel (commit `d05c2103`): cosine
recall at 0.85, deterministic Jaccard on character trigrams at 0.6, then
tag-set agreement. Pairs that pass all three become pending proposals;
nothing auto-merges. Search filters `merged_into IS NULL` so soft-merged
rows stay queryable for audit and `unmerge_memory()` can restore them.
Related: `021_formation_observations` is the shadow-mode auditor variant of
the same idea, `023_memory_bi_temporal_supersession` is the
preserve-both-rows alternative for invalidation.

## 021_formation_observations

Creates the `formation_observations` table recording an LLM's
keep-merge-evolve-discard recommendation for each new memory against its
top-K cosine neighbours, with confidence and reason.

Shadow-mode auditor (commit `e4c2ec86`). Mem0 v3 reversed write-time
auto-merge in April 2025 because auto-applying LLM merges destroys agent
context faster than the LLM gets it right. Formation here observes only;
recommendations land in this table for tuning consolidation thresholds and
eventual opt-in enforcement. Trigger model is explicit:
`chinwag_run_formation_sweep` processes the N most recent unclassified
memories on demand.

## 022_memory_search_hits_per_session

Adds `memories_search_hits` to `sessions`.

Companion to `memories_searched` (`011`): one counts search calls, this
counts calls that returned at least one result (commit `698f063f`). The
distinction is what lets memory-outcome correlation tell "searched and got
something useful" apart from "searched and got nothing", which is a
retrieval-quality signal rather than a memory-usage signal.

## 023_memory_bi_temporal_supersession

Adds `valid_at` (backfilled to `created_at`) and `invalid_at` to `memories`,
a partial index on `invalid_at`, and a `kind` column on
`consolidation_proposals` defaulting to `'merge'`.

Bi-temporal supersession adapted from Graphiti (commit `0c8b6029`).
`valid_at` is when the real-world fact became true; `invalid_at` is when it
stopped. This ships alongside the existing `merged_into` mechanism (`020`)
rather than replacing it: merge absorbs content into one row,
`'invalidate'` preserves both rows with the older one hidden from default
search. Different semantics, kept separate. `expired_at` (DB-action time)
deliberately not added because no caller distinguishes ingestion time from
fact-validity time today.

## 024_lock_glob_patterns_and_ttl

Adds `path_glob` and `expires_ts` to `locks` plus partial indexes on each so
the conflict-check fast path and TTL sweep stay cheap.

Adapted from `mcp_agent_mail`'s `FileReservation` model (commit `06b9c4c3`).
Lets an agent declare scope as one claim ("reserve `src/auth/**` for 30
minutes") instead of hammering the lock table with every touched file.
`path_glob` is non-null only when `file_path` is itself a pattern, so the
conflict checker can `WHERE path_glob IS NOT NULL` before running the
matcher. The heartbeat-based liveness check still applies; `expires_ts` is
the explicit-TTL path on top.

## 025_commit_noise_flag

Adds `is_noise` to `commits` and a partial index on
`(created_at) WHERE is_noise = 0` for the analytics fast path.

Lockfile bumps, formatting passes, merge commits, and WIP checkpoints get
recorded so the audit trail stays intact, but they distort commit-rate
analytics if treated as substantive (commit `b36f5a1f`). Classification
happens at write time; rules live in `commit-noise.ts`. Adapted from
memorix's `noise-filter.ts`.

## 026_session_active_time

Adds `active_min` (REAL) and `last_active_at` to `sessions`.

Active-time tracking so the Focus rank axis stops being a proxy for
"the MCP process stayed open" (commit `dedbd774`). Every activity path
(`recordEdit`, `recordToolCalls`, memory ops) bumps `active_min` by the
elapsed gap since `last_active_at`, capped at `ACTIVE_GAP_THRESHOLD_S`. Gaps
larger than the threshold are dropped on the floor; that is the entire
point. The resulting `active_min` is what feeds Focus in `rank.ts`.

## 027_team_owners_roster

Creates the `team_owners` table (one row per owner per team) with a backfill
from existing `members` rows.

Splits roster from presence (commit `7ff0a8e2`). `members` is presence: rows
are inserted on join, refreshed on heartbeat, and deleted by cleanup when
the heartbeat goes stale. That is correct for "who is active here right
now" and wrong as the gate for owner-scoped reads. Using `members` as the
gate caused idle dashboard users to be silently removed from `user_teams`
when `getSummary` returned `NOT_MEMBER` (the "kicked out while idle" bug).
`team_owners` is the persistent roster, never touched by cleanup, gated by
`#withOwner`. The backfill recovers any owner with a current `members` row;
owners whose `members` rows aged out before this migration ran must rejoin
via `chinmeister init`.
