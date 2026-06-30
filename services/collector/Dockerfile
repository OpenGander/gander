ARG COLLECTOR_VERSION=0.139.0
FROM otel/opentelemetry-collector-contrib:${COLLECTOR_VERSION}

COPY config.yaml /etc/otelcol-contrib/config.yaml

EXPOSE 4317 4318 13133

CMD ["--config=/etc/otelcol-contrib/config.yaml"]
