"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      // Full navigation so the new cookie is sent on the next request.
      const next = params.get("next");
      const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      window.location.assign(safe);
      return;
    }
    setError(res.status === 401 ? "Wrong passphrase" : "Something went wrong");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Learning Reels</h1>
        <p className="text-sm text-zinc-400">Enter your passphrase to continue.</p>
      </div>
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Passphrase"
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-indigo-400"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-medium text-white transition disabled:opacity-50"
      >
        {busy ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
