<div align="center">

# 🪿 OpenGander

**Self-hosted GenAI / LLM observability, built on OpenTelemetry.**

Point any OTel-instrumented LLM app at OpenGander and get traces, prompt/response
inspection, token & cost accounting, and latency/error breakdowns by model —
running entirely on your own hardware, no cloud lock-in.

</div>

---

## Why

LLM apps are hard to observe: opaque latency, runaway token spend, silent quality
regressions. OpenGander treats GenAI telemetry as first-class OpenTelemetry data —
adopting the [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai)
(`gen_ai.*`) — and stores it in ClickHouse, so any instrumentation that speaks OTLP
(OpenLLMetry, OpenInference, native OTel) works out of the box.

- **Self-hosted first.** One `docker compose` stack on a single box. No AWS, no SaaS bill.
- **Standard OTLP in.** Your apps export OTLP; OpenGander ingests it. No proprietary SDK required.
- **Multi-tenant.** Tenants/users/auth in Postgres; telemetry in ClickHouse.

## Stack

| Layer | Tech |
|---|---|
| App / dashboard | Next.js 15, React 19, Tailwind, shadcn/ui |
| Telemetry store | ClickHouse (OTLP-native schema) |
| Control plane | Postgres + Drizzle (tenants, users, OAuth 2.1, RBAC) |
| Ingestion | OpenTelemetry Collector (OTLP gRPC/HTTP) |
| Query for agents | MCP server (Claude/Cursor) |

## Quickstart

```bash
cp infra/compose/env/base.env infra/compose/env/local.env   # edit secrets
make up                                                       # bring up the full stack
```

Then point an OTel-instrumented LLM app at the collector (`http://localhost:4318`)
and open the dashboard at `http://localhost:3003`.

## Documentation

- [**Architecture**](docs/architecture.md) — how the pipeline fits together, the
  data model, and current implementation status.
- [**Usage**](docs/usage.md) — running the stack, instrumenting your app, and
  configuration.

## License

MIT — see [LICENSE](LICENSE).
