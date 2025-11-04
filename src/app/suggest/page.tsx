'use client';
import AuthGate from '@/components/AuthGate';

export default function SuggestPage() {
  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-4">Suggestions</h1>
      <p className="text-gray-700">Your personalized recommendations will appear here.</p>
    </AuthGate>
  );
}
