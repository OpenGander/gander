# OpenGander MCP Server Dockerfile
# Multi-stage build for ARM64 deployment

# =============================================================================
# Stage 1: Build environment with uv
# =============================================================================
FROM python:3.12-slim AS builder

# Install uv for fast dependency management
RUN pip install --no-cache-dir uv

WORKDIR /app

# Copy dependency files first for layer caching
COPY pyproject.toml README.md ./

# Create virtual environment and install dependencies
RUN uv venv /app/.venv && \
    . /app/.venv/bin/activate && \
    uv pip install --no-cache .

# Copy source code
COPY src/ ./src/

# Install the package itself
RUN . /app/.venv/bin/activate && \
    uv pip install --no-cache -e .

# =============================================================================
# Stage 2: Production runtime
# =============================================================================
FROM python:3.12-slim AS runtime

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser

WORKDIR /app

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy source code
COPY --from=builder /app/src /app/src

# Set ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Ensure venv is in PATH
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"
ENV PYTHONUNBUFFERED=1

# Default environment variables
ENV CLICKHOUSE_HOST=localhost
ENV CLICKHOUSE_PORT=8123
ENV CLICKHOUSE_DATABASE=opengander
ENV MCP_LOG_LEVEL=INFO
ENV MCP_PORT=8000

# Expose the MCP server port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Run the server
CMD ["uvicorn", "opengander_mcp.server:app", "--host", "0.0.0.0", "--port", "8000"]
