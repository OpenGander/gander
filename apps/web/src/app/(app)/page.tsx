import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { DashboardClient } from '@/components/dashboard/DashboardClient';

export default async function DashboardPage() {
  // Server-side auth check (runs in Node.js runtime, not Edge)
  const session = await getSession();

  if (!session) {
    redirect('/signin?from=/');
  }

  // If authenticated, render the client dashboard
  return <DashboardClient />;
}
