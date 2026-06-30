/**
 * Settings Page - Redirects to Members
 */

import { redirect } from 'next/navigation';

export default function SettingsPage() {
  redirect('/settings/members');
}
