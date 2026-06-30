-- OpenGander telemetry store — OpenTelemetry-native ClickHouse schema.
--
-- These are the standard otel-collector-contrib ClickHouse exporter tables:
-- traces, metrics (sum/gauge/histogram), and logs. GenAI spans (gen_ai.*
-- attributes) land in otel_traces.SpanAttributes with no schema change.
--
-- Multi-tenant: TenantId is materialized from ResourceAttributes['TenantId'],
-- partitioned per-tenant, with a 30-day TTL. GenAI rollup views and the
-- token-cost model are added by later migrations under this directory.

CREATE DATABASE IF NOT EXISTS opengander;

-- ============================================================================
-- TRACES: distributed tracing spans (incl. GenAI spans via gen_ai.* attrs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS opengander.otel_traces (
    Timestamp DateTime64(9) CODEC(Delta, ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    ParentSpanId String CODEC(ZSTD(1)),
    TraceState String CODEC(ZSTD(1)),
    SpanName LowCardinality(String) CODEC(ZSTD(1)),
    SpanKind LowCardinality(String) CODEC(ZSTD(1)),
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    Duration Int64 CODEC(ZSTD(1)),
    StatusCode LowCardinality(String) CODEC(ZSTD(1)),
    StatusMessage String CODEC(ZSTD(1)),
    Events Nested (
        Timestamp DateTime64(9),
        Name LowCardinality(String),
        Attributes Map(LowCardinality(String), String)
    ) CODEC(ZSTD(1)),
    Links Nested (
        TraceId String,
        SpanId String,
        TraceState String,
        Attributes Map(LowCardinality(String), String)
    ) CODEC(ZSTD(1)),
    TenantId LowCardinality(String) MATERIALIZED ResourceAttributes['TenantId'] CODEC(ZSTD(1)),
    -- Derived hour-friendly timestamp; used by the GenAI rollup views.
    ts DateTime DEFAULT toDateTime(Timestamp),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_service_name ServiceName TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_name SpanName TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1,
    INDEX idx_tenant_id TenantId TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY (TenantId, toDate(ts))
ORDER BY (TenantId, ServiceName, SpanName, ts, TraceId)
TTL ts + INTERVAL 30 DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- ============================================================================
-- METRICS: created by the collector's ClickHouse exporter, not here.
-- ============================================================================
-- The contrib ClickHouse exporter owns the metrics-table DDL
-- (otel_metrics_sum/gauge/histogram/summary/exponential_histogram) and its
-- columns change between collector versions — pre-creating them here drifts out
-- of sync (e.g. a missing ServiceName column breaks inserts). We let the
-- exporter create them on first export (create_schema is on). otel_traces and
-- otel_logs below ARE pre-created because we customize them for multi-tenant
-- partitioning + the derived `ts` column the GenAI rollup views depend on.

-- ============================================================================
-- LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS opengander.otel_logs (
    Timestamp DateTime64(9) CODEC(Delta, ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    TraceFlags UInt32 CODEC(ZSTD(1)),
    SeverityText LowCardinality(String) CODEC(ZSTD(1)),
    SeverityNumber Int32 CODEC(ZSTD(1)),
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    Body String CODEC(ZSTD(1)),
    ResourceSchemaUrl String CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeSchemaUrl String CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    TenantId LowCardinality(String) MATERIALIZED ResourceAttributes['TenantId'] CODEC(ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_service_name ServiceName TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_severity SeverityText TYPE set(25) GRANULARITY 1,
    INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,
    INDEX idx_tenant_id TenantId TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (TenantId, ServiceName, SeverityText, toUnixTimestamp(Timestamp), TraceId)
TTL toDateTime(Timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
