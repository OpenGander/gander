# OpenGander MCP Server - Promptfoo Evaluations

This directory contains [Promptfoo](https://www.promptfoo.dev/) evaluations for the OpenGander MCP Server. These tests verify functionality, security, and compliance of the MCP tools.

## Directory Structure

```
promptfoo/
├── promptfooconfig.yaml    # Main configuration
├── providers/
│   ├── __init__.py
│   └── mcp_provider.py     # Custom Python provider for MCP tool calls
├── tests/
│   ├── tools.yaml          # Functionality tests for all 10 tools
│   └── security.yaml       # Security and tenant isolation tests
└── README.md               # This file
```

## Prerequisites

1. Install Promptfoo:
   ```bash
   npm install -g promptfoo
   # or
   npx promptfoo
   ```

2. Install Python dependencies:
   ```bash
   pip install httpx
   ```

3. Start the MCP server (in another terminal):
   ```bash
   cd services/mcp-server
   python -m opengander_mcp.server
   # or
   uvicorn opengander_mcp.server:app --host 0.0.0.0 --port 8000
   ```

## Environment Variables

### Required for Functionality Tests

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_ENDPOINT` | MCP server base URL | `http://localhost:8000` |
| `MCP_TEST_API_KEY` | Valid API key for tests | (none) |

### Required for Security Tests

| Variable | Description |
|----------|-------------|
| `MCP_TEST_API_KEY_TENANT_A` | API key scoped only to tenant A |
| `MCP_TEST_API_KEY_TENANT_B` | API key scoped only to tenant B |
| `MCP_TEST_TENANT_A_ID` | Tenant A's ID |
| `MCP_TEST_TENANT_B_ID` | Tenant B's ID |
| `MCP_TEST_REVOKED_KEY` | A revoked API key |
| `MCP_TEST_EXPIRED_KEY` | An expired API key |

### Example Setup

```bash
export MCP_ENDPOINT="http://localhost:8000"
export MCP_TEST_API_KEY="og_test_abc123..."

# For tenant isolation tests
export MCP_TEST_API_KEY_TENANT_A="og_test_tenant_a_..."
export MCP_TEST_API_KEY_TENANT_B="og_test_tenant_b_..."
export MCP_TEST_TENANT_A_ID="tenant-a-uuid"
export MCP_TEST_TENANT_B_ID="tenant-b-uuid"

# For revoked/expired key tests
export MCP_TEST_REVOKED_KEY="og_test_revoked_..."
export MCP_TEST_EXPIRED_KEY="og_test_expired_..."
```

## Running Tests

### Run All Tests

```bash
cd services/mcp-server/promptfoo
promptfoo eval
```

### Run Specific Test Files

```bash
# Functionality tests only
promptfoo eval --config tests/tools.yaml

# Security tests only
promptfoo eval --config tests/security.yaml
```

### View Results

```bash
# Launch web UI to view results
promptfoo view

# Or view in terminal
promptfoo view --table
```

### CI/CD Integration

```bash
# Run tests and output results as JSON
promptfoo eval --output results.json

# Run with specific pass threshold
promptfoo eval --grader-threshold 0.9

# Run with GitHub Actions format
promptfoo eval --output github
```

## Test Categories

### Functionality Tests (`tests/tools.yaml`)

Tests that each tool:
- Returns the expected response schema
- Handles valid inputs correctly
- Provides sensible defaults for optional parameters
- Respects limit parameters
- Returns appropriate empty results for future dates

**Tools tested:**
1. `health_check` - Server health verification
2. `list_tables` - Schema discovery
3. `describe_table` - Table column details
4. `get_overview` - Dashboard metrics
5. `get_page_views` - Time series page views
6. `get_top_pages` - Most visited pages
7. `get_web_vitals` - Core Web Vitals (LCP, FID, CLS, TTFB, INP)
8. `get_traffic_sources` - Traffic source breakdown
9. `get_campaigns` - Campaign performance
10. `get_errors` - Error tracking
11. `get_user_journey` - Session path analysis

### Security Tests (`tests/security.yaml`)

**Authentication Validation:**
- Missing API key rejection
- Invalid API key rejection
- Expired API key rejection
- Revoked API key rejection
- Malformed API key handling

**Tenant Isolation:**
- Cross-tenant data access prevention
- All tools tested for tenant boundary enforcement
- Invalid tenant ID handling

**SQL Injection Prevention:**
- Table name parameter injection
- Date parameter injection
- Tenant ID parameter injection
- Session ID parameter injection
- Limit parameter injection

**Input Sanitization:**
- Unicode character handling
- Null byte handling
- Path traversal prevention
- Very long input handling

**Response Security:**
- No sensitive data in error messages
- No stack traces exposed
- No internal details leaked

## Custom Provider

The `providers/mcp_provider.py` file implements a custom Promptfoo provider that:

1. Extracts tool name and arguments from test variables
2. Makes HTTP requests to the MCP server's JSON-RPC endpoint
3. Handles authentication via Bearer tokens
4. Parses MCP tool responses
5. Returns formatted output for Promptfoo assertions

### Provider Usage in Tests

```yaml
tests:
  - description: Test description
    vars:
      tool: get_overview
      args:
        start_date: "2025-01-01"
        end_date: "2025-01-31"
      api_key: "${MCP_TEST_API_KEY}"  # Optional override
    assert:
      - type: is-json
      - type: javascript
        value: |
          const data = JSON.parse(output);
          return data.metrics !== undefined;
```

## Writing New Tests

### Basic Test Structure

```yaml
tests:
  - description: Clear description of what's being tested
    vars:
      tool: tool_name
      args:
        param1: value1
        param2: value2
    assert:
      - type: is-json
      - type: javascript
        value: |
          const data = JSON.parse(output);
          return data.expected_field !== undefined;
```

### Common Assertions

```yaml
assert:
  # Check output is valid JSON
  - type: is-json

  # Check for presence of text
  - type: contains
    value: "expected text"

  # Check absence of text
  - type: not-contains
    value: "should not appear"

  # JavaScript custom logic
  - type: javascript
    value: |
      const data = JSON.parse(output);
      return data.field === "expected";

  # JSON structure validation
  - type: contains-json
    value:
      key: "expected_value"
```

## Troubleshooting

### Connection Errors

If tests fail with "Connection failed":
1. Verify MCP server is running
2. Check `MCP_ENDPOINT` is correct
3. Verify firewall/network access

### Authentication Errors

If tests return 401 errors:
1. Verify `MCP_TEST_API_KEY` is set
2. Check API key is not expired
3. Verify API key is not revoked

### Test Timeouts

Default timeout is 30 seconds. To increase:
```yaml
defaultTest:
  options:
    timeout: 60000  # 60 seconds
```

## Output

Test results are saved to `./output/results.json` by default.

Results include:
- Pass/fail status for each test
- Full request/response data
- Assertion evaluation details
- Timing information
