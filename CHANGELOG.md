# Changelog

## v1.0.0 — 2026-09-24

First release.

**Targets**
- OpenRouter models: prompt templates, parameters, JSON mode, extra request fields, and MCP tool agent loops.
- HTTP endpoints: templated requests and JSONPath output extraction.
- Workflows: chained steps with a per-step trace.
- MCP tools: templated arguments.
- A "Try it" panel for every target.

**Evaluation**
- TypeSafe Jev evaluators (yes/no, choice, score), batched into one request per result, with needs-review flags.
- An OpenRouter LLM judge with written reasoning.
- 11 deterministic assertions, including tool-call checks.
- Weighted scoring, informational evaluators, and human verdict overrides.

**Runs**
- Queued runs (pg-boss) with live progress (SSE).
- Several targets compared in one run, in a case × target grid.
- A result drawer with Jev probability bars.
- Run-to-run comparison.
- CI API tokens.

**Metrics:** a filterable dashboard covering trends, latency percentiles, cost, score distribution, evaluator / tag / tool breakdowns and a leaderboard. Every chart has a table view and colorblind-validated palettes.

**MCP**
- Registry for Streamable HTTP, SSE and stdio servers.
- Health checks, and inspection of tools, resources and prompts.
- A schema-driven tool playground.
- Pooled connections that are warmed up before runs.

**OAuth 2.1 for MCP**
- Discovery (RFC 9728 → RFC 8414).
- Dynamic or pre-registered clients (RFC 7591).
- PKCE S256 and the RFC 8707 `resource` indicator.
- Popup sign-in that only the user who started it can complete.
- Encrypted token storage and automatic refresh, with concurrent refreshes de-duplicated.
- RFC 7009 revocation on disconnect.
- A mock OAuth MCP deployment for local testing.

**Teams:** projects with owner / editor / viewer roles, invites, encrypted per-project secrets, and purple light / dark / system themes.
