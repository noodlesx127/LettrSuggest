export default function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">LettrSuggest</h1>
      <p className="text-gray-700 max-w-2xl">
        Upload your Letterboxd data to get personalized movie suggestions with clear reasons and
        a rich stats dashboard across your history.
      </p>
      <div className="flex gap-3">
        <a className="px-4 py-2 bg-black text-white rounded" href="/auth/login">
          Sign in
        </a>
        <a className="px-4 py-2 bg-gray-200 rounded" href="/auth/register">
          Create account
        </a>
      </div>
    </div>
  );
}
