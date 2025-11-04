'use client';
import AuthGate from '@/components/AuthGate';

export default function AdminPage() {
  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-4">Admin</h1>
      <p className="text-gray-700">User management panel (to be implemented).</p>
    </AuthGate>
  );
}
