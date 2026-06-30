# Using OpenGander

How to run OpenGander on your own hardware and point an LLM app at it.

> **Status:** OpenGander is early. The infrastructure (ClickHouse, the OTel
> collector, Postgres) and the self-host stack run today; the web app's auth
> layer and the GenAI dashboards are still being assembled (see
> [architecture.md → Implementation status](architecture.md#implementation-status)).
> This guide documents the intended end-to-end flow — the commands are real, but
> some surfaces aren't wired up yet.

## Prerequisites

- **Docker** + **Docker Compose** (Docker Desktop, Colima, or a Linux engine).
- ~2 vCPU / 4 GB RAM is plenty for a single-box dev/homelab deployment.
- That's it — Postgres and ClickHouse run as containers; nothing is installed on
  the host.

## Quickstart

```bash
git clone https://github.com/OpenGander/gander.git opengander
cd opengander

# 1. Configure. base.env holds safe dev defaults; put real secrets in local.env.
cp infra/compose/env/base.env infra/compose/env/local.env
#   edit infra/compose/env/local.env  (secrets, email — see Configuration below)

# 2. Bring up the full stack (clickhouse + postgres + collector + web).
make up

# 3. Watch it come up.
make logs
```

`make up` builds and starts everything, applies the Postgres migrations
(via a one-shot `web-migrate` step), and serves the dashboard.

| Service | URL / port |
|---|---|
| Web dashboard | http://localhost:3003 |
| OTLP ingestion (HTTP) | http://localhost:4318 |
| OTLP ingestion (gRPC) | localhost:4317 |
| ClickHouse (HTTP) | http://localhost:8123 |
| Postgres | localhost:5432 |

Stop with `make down` (data volumes are preserved). `make help` lists all targets.

## Sending telemetry from your app

OpenGander ingests **OpenTelemetry** — any instrumentation that exports OTLP and
follows the [GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai)
works. You don't need an OpenGander-specific SDK. Good options:

- **[OpenLLMetry](https://github.com/traceloop/openllmetry)** (Traceloop) — one-line
  auto-instrumentation for OpenAI, Anthropic, LangChain, LlamaIndex, etc.
- **[OpenInference](https://github.com/Arize-ai/openinference)** (Arize)
- **Native OpenTelemetry** instrumentation

### Example: Python with OpenLLMetry

```bash
pip install traceloop-sdk
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

```python
from traceloop.sdk import Traceloop

# resource_attributes carries the tenant (and any service metadata).
Traceloop.init(
    app_name="my-llm-app",
    resource_attributes={"TenantId": "tenant_demo"},
)

# ...your normal LLM calls are now traced automatically:
import anthropic
client = anthropic.Anthropic()
client.messages.create(
    model="claude-opus-4-8",
    max_tokens=256,
    messages=[{"role": "user", "content": "Explain observability in one line."}],
)
```

Each call becomes a `gen_ai.*` span — operation, model, token usage, and
(optionally) the prompt/response — landing in `otel_traces`.

### Setting the tenant

Telemetry is attributed to a tenant via the **`TenantId` resource attribute**.
Set it once when you initialize your SDK (as above), or via the standard env var:

```bash
export OTEL_RESOURCE_ATTRIBUTES="TenantId=tenant_demo,service.name=my-llm-app"
```

> In production the ingestion edge authenticates the request (API key) and stamps
> `TenantId` server-side so it can't be spoofed. For local dev, setting it on the
> client is fine.

## Verifying ingestion

Confirm spans are landing by querying ClickHouse directly:

```bash
curl -s 'http://localhost:8123/?database=opengander' \
  --data-binary "SELECT SpanName, SpanAttributes['gen_ai.request.model'] AS model,
                        SpanAttributes['gen_ai.usage.input_tokens'] AS in_tok,
                        SpanAttributes['gen_ai.usage.output_tokens'] AS out_tok
                 FROM otel_traces
                 WHERE SpanAttributes['gen_ai.operation.name'] != ''
                 ORDER BY Timestamp DESC LIMIT 10 FORMAT Pretty"
```

To eyeball raw spans visually without the full stack, run standalone Jaeger and
point your app at it:

```bash
make jaeger          # Jaeger UI at http://localhost:16686
```

## Configuration

All configuration is environment variables, loaded from
`infra/compose/env/base.env` (committed defaults) and
`infra/compose/env/local.env` (your secrets, gitignored).

### Email (magic-link sign-in)

`EMAIL_PROVIDER` selects how magic-link emails are delivered:

| Value | Behavior |
|---|---|
| `mock` (default) | Logs the magic link to stdout — fine for local dev. |
| `smtp` | Send via any SMTP server (self-hosted, Fastmail, Gmail app password, …). |
| `mailgun` | Send via Mailgun (`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`). |

With `mock`, grab the sign-in link from `make logs` instead of an inbox.

### Secrets

`base.env` ships **safe dev defaults only**. For anything beyond local dev, set
real values in `local.env`:

- `OTEL_TOKEN_SECRET`, `JWT_SECRET` — signing secrets (use `openssl rand -hex 32`).
- `POSTGRES_PASSWORD`, `CLICKHOUSE_PASSWORD` — datastore credentials.
- `OTEL_API_KEY_PRIVATE` — backend ingestion API key.

## Updating the database schema

Postgres migrations (Drizzle) are applied automatically on `make up`. To run them
against a running stack manually:

```bash
make migrate
```

ClickHouse tables are created on first boot from `infra/clickhouse/init.sql`.

## Troubleshooting

- **`make up` can't reach Docker** — start your Docker engine first.
- **Web container unhealthy but app responds** — the healthcheck uses
  `127.0.0.1` (the standalone server binds IPv4 only); give it ~30s after build.
- **No spans showing up** — confirm `OTEL_EXPORTER_OTLP_ENDPOINT` points at
  `http://<host>:4318` and that your app sets a `TenantId` resource attribute;
  check `make logs` for the `otel-collector` service.
