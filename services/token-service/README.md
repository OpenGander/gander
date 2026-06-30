# Token Service

Combined JWT token generation and validation service for browser telemetry sessions.

## Endpoints

### `GET /api/telemetry-token`
Generates a short-lived JWT token for browser telemetry.

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 300,
  "expiresAt": "2024-01-15T12:05:00.000Z"
}
```

### `GET /validate`
Validates JWT tokens for Caddy forward_auth.

**Request:**
```
Authorization: Bearer <token>
```

**Response (valid):**
```json
{ "valid": true }
```

**Response (invalid):**
```json
{ "valid": false, "error": "Token expired" }
```

### `GET /health`
Health check endpoint for monitoring and load balancers.

### `GET /metrics`
Validation metrics including clock skew statistics.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OTEL_TOKEN_SECRET` | Yes | - | JWT signing secret (min 64 chars recommended) |
| `PORT` | No | 3001 | Server port |
| `NODE_ENV` | No | development | Environment mode |
| `ALLOWED_ORIGINS` | Prod only | - | Comma-separated list of allowed origins |
| `TOKEN_TTL` | No | 300 | Token lifetime in seconds |
| `CLOCK_SKEW_TOLERANCE` | No | 60 | Clock skew tolerance in seconds |
| `DEBUG` | No | false | Enable debug logging |

## Security Model

### Token Claims
- `origin`: The origin of the requesting page
- `ip`: The client IP address
- `iat`: Issued at timestamp
- `exp`: Expiration timestamp

### Origin Validation
The service validates the `Origin` header to prevent cross-site token theft. This only works for browser clients due to CORS enforcement.

**Non-browser clients** (curl, Python, etc.) can spoof the Origin header. This is acceptable for RUM use cases - protection comes from:
1. Rate limiting (100 tokens/min per IP)
2. IP binding (tokens tied to client IP)
3. Short TTL (5 minutes)

In short: the service issues short-lived (5-minute) JWTs bound to the requesting origin and client IP, and rate-limits token issuance per IP.

### Clock Skew Handling
The validation endpoint tolerates clock skew between services (default 60 seconds). This handles clock drift between different containers/hosts.

## Development

```bash
npm install
npm run dev
```

## Production

```bash
docker build -t otel-token-service .
docker run -p 3001:3001 --env-file .env otel-token-service
```

## Architecture

```
services/token-service/
├── index.js           # Main app with all endpoints
├── lib/
│   ├── ip.js          # IP normalization and extraction
│   └── jwt.js         # Token generation and validation
├── Dockerfile
├── package.json
└── README.md
```
