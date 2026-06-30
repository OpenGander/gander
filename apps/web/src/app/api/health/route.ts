import { NextResponse } from 'next/server';
import { testClickHouseConnection } from '@/lib/clickhouse';

export async function GET() {
  const clickhouseHealthy = await testClickHouseConnection();

  const health = {
    status: clickhouseHealthy ? 'healthy' : 'unhealthy',
    service: 'opengander-web',
    timestamp: new Date().toISOString(),
    checks: {
      clickhouse: clickhouseHealthy ? 'connected' : 'disconnected',
      oauth_keys:
        process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY ? 'configured' : 'missing',
    },
  };

  return NextResponse.json(health, {
    status: clickhouseHealthy ? 200 : 503,
  });
}
