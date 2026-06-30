/**
 * OpenTelemetry Instrumentation for Token Service
 *
 * Must be loaded BEFORE application code:
 *   node --require ./instrumentation.js index.js
 *
 * Environment Variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT - Collector endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME - Override service name (default: token-service)
 *   OTEL_LOG_LEVEL - Diagnostic log level (default: INFO)
 */

'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { Resource } = require('@opentelemetry/resources');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

const logLevel = process.env.OTEL_LOG_LEVEL?.toUpperCase() || 'INFO';
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel[logLevel]);

const resource = new Resource({
  'service.name': process.env.OTEL_SERVICE_NAME || 'token-service',
  'service.version': process.env.SERVICE_VERSION || '1.0.0',
  'deployment.environment': process.env.NODE_ENV || 'development',
  'service.instance.id': process.env.HOSTNAME || require('os').hostname(),
});

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const traceExporter = new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });
const metricExporter = new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` });

const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 30000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (request) => {
          const ignore = ['/health', '/metrics'];
          return ignore.some((p) => request.url?.startsWith(p));
        },
      },
      '@opentelemetry/instrumentation-express': {},
      '@opentelemetry/instrumentation-pino': {},
      // Disable noisy/unused instrumentations
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
    }),
  ],
});

sdk.start();
console.log(`[OTEL] token-service instrumentation started → ${otlpEndpoint}`);

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});

module.exports = sdk;
