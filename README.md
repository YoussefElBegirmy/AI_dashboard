# AI Eval Dashboard

**v1.0.0**: a self-hosted team dashboard for **testing and evaluating AI APIs, LLM workflows and MCP servers**.

You point it at the things you want to test:
- any model on **OpenRouter**
- your **own HTTP endpoints**
- **multi-step workflows** chaining them
- tools on **MCP servers** (local, remote, or OAuth 2.1-protected)

You run **test suites** against them. Every answer is graded by **[TypeSafe Jev](https://docs.typesafe.ai/)** (fast typed judgments with probabilities), an optional **OpenRouter LLM judge** (with written reasoning), and **deterministic assertions**. Results stream in live, metrics and charts track quality, latency and cost over time, and run-to-run comparison catches regressions before they ship.

Stack: React 19 + Vite + Tailwind 4 · Express 5 + TypeScript · PostgreSQL (Prisma, pg-boss) · MCP TypeScript SDK · TypeSafe SDK.

---

## What it can do

### Test anything that answers
| Target | What you configure |
|---|---|
| **OpenRouter model** | Model picker with live pricing, system prompt, templated user prompt, temperature / max tokens / top-p, JSON mode, and raw extra fields (provider routing, reasoning). Attach **MCP servers** to turn it into an **agent loop**: tools are exposed as `server__tool`, every call is recorded, and the loop stops after a set number of iterations. |
| **HTTP endpoint** | Method, URL, headers, query and a JSON or text body, all templated from the test case. A **JSONPath** picks the answer out of the response. Non-2xx responses are errors, unless you want to test error handling. |
| **Workflow** | Ordered steps. Each step calls another target, and later steps read earlier outputs (`{{steps.draft.output}}`). Every step is traced, with its own latency and cost. |
| **MCP tool** | One tool on a registered MCP server, called with templated arguments. |

Every target has a **Try it** panel that runs the unsaved config once and shows output, JSON, tool calls, trace and the raw response.

**Templates** work everywhere: `{{input.question}}`, `{{expected.answer}}`, `{{secrets.MY_KEY}}`, `{{steps.first.output}}`. In JSON bodies, a value that is exactly `"{{input}}"` keeps its type (object, number…).

### Grade it three ways
| Family | Evaluators |
|---|---|
| **Jev (TypeSafe System One)** | `jev_noul` (yes/no probability), `jev_choice` (one of your labels), `jev_score` (2–10 level rubric). All of a result's Jev questions go out in **one** request, with `state = {input, expected, output, tool_calls}`. Answers near 0.5 or with low confidence are flagged **needs review**. |
| **LLM judge** | An OpenRouter model scores 0–1 against your rubric and explains why. |
| **Assertions** | equals, contains, not-contains, regex, JSON schema, JSONPath, HTTP status, max latency, max cost, **tool called** (with an args subset and a minimum count), tool not called. |

- **Weights:** evaluators carry weights.
- **Must pass vs informational:** each evaluator can be required or just reported.
- **Scope:** suite-level evaluators apply to every case, and a case can add its own evaluators or opt out.
- **Human review:** a reviewer can **override** any verdict. Metrics and comparisons use the override.

### Run, watch, compare
- **Suites:** test cases (input + expected + tags) with import and export in **CSV / JSONL / JSON**.
- **Runs:**
  - Queued on Postgres (pg-boss) and run with per-suite concurrency.
  - Progress streams **live** (SSE).
  - Several targets can run in one run to **compare them side by side**, in a case × target results grid.
- **Result drawer:** every evaluator's verdict with **Jev probability bars**, LLM-judge reasoning, the full response, tool calls, workflow trace, tokens and cost.
- **Compare runs:** regressions, fixes, and score changes per case.
- **CI:** API tokens to start runs and poll them from a pipeline (example below).

### Metrics and graphs
- **Filters:** time window, suite and targets.
- **Charts:**
  - pass rate / score / latency / cost over time per target
  - outcomes by target
  - latency **p50 / p95 / p99**
  - spend and tokens
  - score distribution
  - per-evaluator pass rate and **Jev confidence**
  - per-tag pass rate
  - run history
  - MCP tool usage
  - a target leaderboard
- **Accessibility:** every chart has a table view. Each target keeps one color everywhere, and the palettes are validated for colorblind separation in both themes.

### MCP server management
- **Transports:** Streamable HTTP, legacy HTTP+SSE, and local **stdio** commands (owner role only, because they run on the host).
- **Authentication:** none, static headers (`Authorization: Bearer {{secrets.X}}`), or **OAuth 2.1** (below).
- **Inspect:** test the connection and see tools, resources, prompts and server instructions.
- **Playground:** a form built from each tool's JSON schema (or raw JSON). You can also read resources and render prompts, and **Create test target** turns a tool into a testable target.
- **Connections:** pooled per server, reconnected when config or secrets change, closed when idle, and warmed up before a run so start-up time isn't counted as latency.

### OAuth 2.1 for MCP servers
It implements the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) as a client:

1. **Discovery:** RFC 9728 protected-resource metadata (from the 401 `WWW-Authenticate` header or the path-aware well-known URL), then RFC 8414 authorization-server metadata.
2. **Client registration:** **dynamic** (RFC 7591) as a public client, or a **pre-registered client ID** (optionally a confidential client with a secret from project secrets).
3. **Sign in:** a popup runs the authorization-code flow with **PKCE S256** and the **RFC 8707 `resource`** indicator. The callback only completes for the dashboard user who started it.
4. **Tokens:** stored **AES-256-GCM encrypted** and never sent to the browser. They refresh automatically on 401. Concurrent refreshes are **de-duplicated**, so servers that rotate refresh tokens and revoke on reuse don't kill the grant.
5. **Disconnect** revokes the refresh token (RFC 7009) where supported.

One signed-in connection serves the whole project: the playground, MCP tool targets, and LLM agent loops.

### Team and security
- **Access:** projects with **owner / editor / viewer** roles, invite links, and Postgres-backed sessions.
- **Secrets:** per-project and encrypted at rest.
- **Themes:** purple **light and dark**, with a Light / Dark / System switch.

---

## Quick start

Requirements: Node 20+ (tested on 24), Docker (for Postgres).

```bash
cp .env.example .env            # set SESSION_SECRET and MASTER_KEY to long random strings
npm install                     # also generates the Prisma client
npm run db:up                   # Postgres 16 in Docker (port 5432)
npm run db:migrate              # create the schema
npm run dev                     # API :3001 + web :5173
```

Open http://localhost:5173. **The first account you register becomes the administrator.** Others join through invite links (Settings → Members), or through open sign-up if you set `ALLOW_SIGNUP=true`.

1. **Settings → Secrets**: add `OPENROUTER_API_KEY` (models and the LLM judge) and `TYPESAFE_API_KEY` (Jev).
2. **Targets → New target**: pick a kind and check it with **Try it**.
3. **Test suites → New suite**: add or import cases, then pick evaluators.
4. **Run suite**: choose one or more targets and watch the results arrive.
5. **Metrics** has the charts. **Runs → Compare** shows regressions.

For a quick first run, the API includes sample endpoints (`ENABLE_DEV_MOCKS=true`):

- `POST /dev/mock/echo`
- `POST /dev/mock/qa`: capital-city answers, some of them deliberately wrong
- `POST /dev/mock/flaky`: fails 30% of the time

It also includes a mock **OAuth-protected MCP deployment** for trying the OAuth flow: `npm run mock:oauth-mcp -w @aieval/server`, then add `http://localhost:8090/polaris/mcp` with Authentication = OAuth 2.1.

---

## Connecting the Hexifyer Polaris and DevStudio MCP servers

The Hexifyer MCP server (`mcp polrais`) is one deployment with **two connectors**, and each is its own OAuth resource:

```
https://<MCP_PUBLIC_URL>/polaris/mcp      → token app claim POLARIS_WEB
https://<MCP_PUBLIC_URL>/devstudio/mcp    → token app claim DEV_STUDIO
          ▲ resource server                     ▲
          └── tokens issued by hexifyer-backend (/oauth/*: DCR, PKCE S256, resource required)
```

A Polaris token is refused at the DevStudio mount twice over, once by audience and once by the `app` claim. So **add them as two MCP servers and sign in to each one separately.**

1. **MCP servers → Add server** → preset **Hexifyer Polaris (OAuth)**.
2. Replace `<your-mcp-host>` with the real host. The URL must be **exactly** `{MCP_PUBLIC_URL}/polaris/mcp` (see the checks below).
3. Keep the scope list, or trim it:
   - The preset requests all seven Hexifyer scopes, and the consent screen lets you untick any.
   - For read-only, use `projects:read tasks:read topics:read sprints:read`.
   - If you leave the field empty, the dashboard requests every scope the server advertises, which includes write.
4. **Add & connect**, then **Sign in**. The Hexifyer consent wizard opens in a popup: sign in with your Hexifyer account, pick the workspace (and projects), then Allow.
5. The popup closes, the panel shows **Signed in** with the granted scopes, and the tools (`hexifyer_get_task`, `hexifyer_get_project`…) are listed.
6. Repeat with the **Hexifyer DevStudio (OAuth)** preset and `/devstudio/mcp`.

Now use them:
- **Playground:** call any tool by hand.
- **Create test target** on a tool, then build a suite, for example: `hexifyer_get_task` with `{"task": "{{input.task}}"}`, a `contains` assertion on the expected title, and a Jev noul "Does the card answer the question?".
- **LLM agent tests:** attach both servers to an **OpenRouter model** target and assert `tool_called: polaris__hexifyer_get_task`.

**Checks when it doesn't connect**

| Symptom | Cause / fix |
|---|---|
| `Protected resource … does not match` | The URL you entered differs from the mount's advertised `resource`. Use exactly `{MCP_PUBLIC_URL}/{slug}/mcp` (same scheme, host and path). |
| `invalid_target` on the consent step | The backend's `MCP_RESOURCE_URL_POLARIS` / `MCP_RESOURCE_URL_DEVSTUDIO` don't equal the mount URLs. They must match byte for byte. |
| `invalid_client_metadata` at registration | The dashboard's redirect URI must be `https://…` or `http://localhost…`. It is `{APP_URL}/api/mcp-oauth/callback`, so a deployed dashboard needs HTTPS. |
| `invalid_scope` | A requested scope isn't one of the seven Hexifyer scopes. |
| Writes come back as a preview | That's Hexifyer's confirmation gate: a write returns a preview and a `confirm_token`, and it only applies when called again with `confirm: true`. Test both steps in a workflow, or let an agent handle it. |
| 429s during runs | Hexifyer allows 10 writes and 60 reads per minute per grant. Lower the suite concurrency. |
| **Sign-in required** after a while | The refresh token was revoked, or its 30-day life ran out. Press **Sign in** again. |

**Local development:** you can run the MCP server locally (`.\scripts\dev.ps1` → `http://127.0.0.1:8080/polaris/mcp`). It only works if the backend you authenticate against has `MCP_RESOURCE_URL_*` set to those local URLs, usually a local backend. With the shared dev or production backend, use the deployed MCP URL.

---

## CI

Create a token under **Settings → API tokens**:

```bash
RUN=$(curl -s -X POST -H "Authorization: Bearer $AIEVAL_TOKEN" -H "Content-Type: application/json" \
  -d '{"tags": ["smoke"]}' https://your-host/api/v1/suites/<SUITE_ID>/runs | jq -r .id)
while :; do
  R=$(curl -s -H "Authorization: Bearer $AIEVAL_TOKEN" https://your-host/api/v1/runs/$RUN)
  [ "$(echo "$R" | jq .finished)" = "true" ] && break; sleep 5
done
[ "$(echo "$R" | jq '.failed + .errored')" = "0" ]   # fail the build on any failure
```

Without `targetIds`, the run uses the suite's **default targets** (suite → Settings).

---

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `PORT` | API port (3001) |
| `APP_URL` | Public URL of the web app. It is used for CORS, invite links and the **OAuth redirect URI** (`{APP_URL}/api/mcp-oauth/callback`). |
| `SESSION_SECRET` | Signs session cookies |
| `MASTER_KEY` | Encrypts secrets and OAuth tokens at rest. **Don't lose it.** |
| `ALLOW_SIGNUP` | Open registration (otherwise first user + invites) |
| `ENABLE_DEV_MOCKS` | Enables `/dev/mock/*` |
| `OPENROUTER_API_KEY`, `TYPESAFE_API_KEY` | Optional server-wide fallbacks for projects without their own secret |
| `TEST_DATABASE_URL` | Disposable database for `npm run test:api` (it gets wiped) |

---

## Development

```
apps/server     Express API, Prisma schema, execution engine
                  engine/runners      OpenRouter (+ MCP agent loop), HTTP, workflow, MCP tool
                  engine/evaluators   Jev, LLM judge, assertions, verdict
                  engine/mcp          connection pool + OAuth 2.1 client provider
                  dev/                mock endpoints, mock OAuth MCP deployment
apps/web        React app (pages/, components/, lib/)
packages/shared zod schemas + types shared by both (targets, evaluators, MCP, suites)
```

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + web (Vite) |
| `npm test` | Unit tests: templating, assertions, Jev mapping and batching, runners, the tool loop, workflows |
| `npm run db:test:setup -w @aieval/server` then `npm run test:api` | API + OAuth integration tests against `TEST_DATABASE_URL` |
| `npm run typecheck` | Type-check all packages |
| `npm run build && npm start` | Build the web app. The API serves it from `apps/web/dist` on :3001 |
| `npm run mock:oauth-mcp -w @aieval/server` | Local OAuth-protected MCP deployment on :8090 |
| `npm run db:studio` | Prisma Studio |

**Adding a new kind of endpoint:** add a zod config schema in [packages/shared/src/targets.ts](packages/shared/src/targets.ts) and a runner in [apps/server/src/engine/runners/](apps/server/src/engine/runners/), then register it in `runners/index.ts`.

**Theming:** colors are CSS variables in [apps/web/src/index.css](apps/web/src/index.css). Chart palettes per mode are in [apps/web/src/components/charts.tsx](apps/web/src/components/charts.tsx).

**Scaling note:** runs execute in-process from the pg-boss queue (3 at a time). Live progress uses an in-process event bus, so run one API instance, or add a Postgres LISTEN/NOTIFY bridge before scaling out.

See [CHANGELOG.md](CHANGELOG.md) for release notes.
