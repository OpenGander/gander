# OTEL Collector

Configuration for the OpenTelemetry Collector and its Caddy reverse proxy sidecar -- not a custom service, just config files for off-the-shelf images.

## Contents

- `config.yaml` - OpenTelemetry Collector configuration (receivers, processors, exporters, pipelines)
- `Caddyfile.aws` - Caddy reverse proxy config for AWS ECS deployment
- `Dockerfile` - Collector image (based on `otel/opentelemetry-collector-contrib`)
- `Dockerfile.caddy` - Caddy sidecar image

The local development Caddyfile lives in `infra/docker/caddy/Caddyfile` since it is specific to the Docker Compose environment.

## How It Works

```
Browser SDK --> Caddy (JWT validation, CORS) --> OTEL Collector --> ClickHouse
```

The Collector receives traces, metrics, and logs via OTLP (gRPC on 4317, HTTP on 4318) and exports them to ClickHouse. In production, Caddy sits in front as a sidecar in the same ECS task:

1. Caddy receives the request and handles CORS preflight
2. Caddy calls `forward_auth` to token-service `/validate` to verify the JWT
3. Token-service returns `X-Tenant-Id` header, which Caddy copies upstream
4. Caddy proxies the validated request to the Collector on localhost:4318

In local development (Docker Compose), the Collector's built-in CORS is enabled with `allowed_origins: ["*"]` and Caddy is optional.

## Key Patterns

The collector config uses processors as security layers: `memory_limiter` prevents OOM from flooding attacks (512 MiB hard limit), `batch` uses conservative sizes (512/1024), and `filter` drops health check spans, spans missing required fields, and spans with suspicious names. The `attributes` processor strips sensitive headers (Authorization, Cookie, Set-Cookie).

All three pipelines (traces, metrics, logs) flow through `memory_limiter -> batch -> clickhouse`. The TenantId for multi-tenant isolation comes from the browser SDK's resource attributes, validated by the Caddy/token-service sidecar.

## Decisions

- **Caddy sidecar, not middleware.** JWT validation happens in Caddy via `forward_auth` rather than in a custom OTEL processor. This keeps the collector config standard (no custom builds) and reuses token-service's existing validation logic. The tradeoff is an extra container, but it runs in the same ECS task so latency is negligible.
- **Separate Caddyfiles per environment.** AWS uses ALB for TLS termination and trusts `10.0.0.0/8` for `X-Forwarded-For`. Local dev has different trust boundaries. Rather than templating one file, we keep separate Caddyfiles.
- **Tail sampling commented out.** The config includes a commented `tail_sampling` section ready to enable when traffic volume demands it (always sample errors and slow requests, 10% probabilistic for the rest).

## Related

- `../../infra/docker/caddy/` - Local development Caddyfile
- `../../services/token-service/` - JWT validation service that Caddy calls via forward_auth
- `../../infra/compose/docker-compose.yml` - How the collector runs in local dev
- `../../infra/aws/templates/` - CloudFormation templates for the ECS task definition
