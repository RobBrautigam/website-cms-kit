"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function VerifyForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<{ factor_id: string; challenge_id: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/mfa/challenge", { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as { factor_id: string; challenge_id: string };
        setChallenge(data);
      } else {
        const data = (await res.json()) as { error: string };
        setError(data.error ?? "Could not start challenge");
      }
    })();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [method]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body =
      method === "totp"
        ? {
            method: "totp",
            factor_id: challenge?.factor_id,
            challenge_id: challenge?.challenge_id,
            code,
          }
        : { method: "recovery", code };
    const res = await fetch("/api/admin/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json()) as { error: string };
      setError(data.error ?? "Verification failed");
      return;
    }
    const data = (await res.json()) as { redirect?: string };
    router.push(data.redirect ?? "/admin/posts");
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
      <div>
        <h1 className="text-2xl font-bold mb-2">Two-factor authentication</h1>
        <p className="text-sm text-text-secondary">
          {method === "totp"
            ? "Enter the 6-digit code from your authenticator app."
            : "Enter one of your recovery codes (xxxx-xxxx-xxxx)."}
        </p>
      </div>
      <input
        ref={inputRef}
        type="text"
        inputMode={method === "totp" ? "numeric" : "text"}
        autoComplete="one-time-code"
        pattern={method === "totp" ? "[0-9]{6}" : undefined}
        value={code}
        onChange={(e) =>
          setCode(method === "totp" ? e.target.value.replace(/\D/g, "") : e.target.value)
        }
        className="w-full px-4 py-3 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent transition text-center text-xl tracking-widest font-mono"
        aria-label={method === "totp" ? "6-digit verification code" : "Recovery code"}
      />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={busy || code.length === 0}
        className="w-full btn-primary py-3 text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Verifying…" : "Verify"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMethod(method === "totp" ? "recovery" : "totp");
          setCode("");
          setError(null);
        }}
        className="w-full text-center text-sm text-text-secondary hover:text-accent transition-colors underline"
      >
        {method === "totp" ? "Use a recovery code instead" : "Use authenticator code instead"}
      </button>
    </form>
  );
}
