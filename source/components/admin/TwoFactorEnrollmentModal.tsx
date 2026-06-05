"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ModalShell from "./ModalShell";

type Step = "loading" | "qr" | "verify" | "codes";

interface EnrollData {
  factor_id: string;
  qr_code: string;
  secret: string;
}

export function TwoFactorEnrollmentModal({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<Step>("loading");
  const [enrollment, setEnrollment] = useState<EnrollData | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/admin/mfa/enroll", { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Could not start enrollment");
          return;
        }
        setEnrollment(json);
        setStep("qr");
      } catch {
        setError("Could not start enrollment");
      }
    })();
  }, []);

  useEffect(() => {
    if (step === "verify") {
      const t = setTimeout(() => codeInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [step]);

  const onVerify = async () => {
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/mfa/verify-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factor_id: enrollment.factor_id, code }),
      });
      const json = await res.json();
      setBusy(false);
      if (!res.ok) {
        setError(json.error ?? "Verification failed");
        return;
      }
      setRecoveryCodes(json.recovery_codes);
      setStep("codes");
    } catch {
      setBusy(false);
      setError("Verification failed");
    }
  };

  const onClosingFromCodes = () => {
    if (
      window.confirm(
        "Have you saved these recovery codes? They will not be shown again."
      )
    ) {
      onComplete();
      onClose();
    }
  };

  const onClosingDuringSetup = () => {
    onClose();
  };

  const downloadCodes = () => {
    const blob = new Blob(
      [
        `Acme admin recovery codes\nGenerated: ${new Date().toISOString()}\n\n${recoveryCodes.join("\n")}\n\nKeep these in a password manager. Each code can be used once if you lose your authenticator.\n`,
      ],
      { type: "text/plain" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `acme-recovery-codes-${new Date()
      .toISOString()
      .slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    toast.success("Recovery codes copied to clipboard");
  };

  return (
    <ModalShell
      onClose={step === "codes" ? onClosingFromCodes : onClosingDuringSetup}
      ariaLabelledBy="mfa-enrollment-title"
    >
      <h2 id="mfa-enrollment-title" className="text-xl font-bold mb-4">
        Set up two-factor authentication
      </h2>

      {step === "loading" && !error && (
        <p className="text-sm text-text-secondary">Preparing enrollment…</p>
      )}

      {error && step !== "verify" && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {step === "qr" && enrollment && (
        <div className="space-y-4">
          <p className="text-sm">
            Scan this QR code with your authenticator app (Authy, 1Password, Google Authenticator).
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrollment.qr_code}
            alt="MFA QR code"
            className="mx-auto"
          />
          <details className="text-xs">
            <summary className="cursor-pointer">
              Can&apos;t scan? Enter the secret manually
            </summary>
            <code className="mt-2 block break-all rounded bg-bg-elevated p-2 font-mono">
              {enrollment.secret}
            </code>
          </details>
          <button
            type="button"
            onClick={() => setStep("verify")}
            className="w-full rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white"
          >
            I&apos;ve scanned it — Continue
          </button>
        </div>
      )}

      {step === "verify" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onVerify();
          }}
          className="space-y-4"
        >
          <p className="text-sm">
            Enter the 6-digit code from your authenticator app.
          </p>
          <input
            ref={codeInputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="w-full rounded border px-3 py-2 text-center text-2xl tracking-widest font-mono"
            aria-label="6-digit verification code"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}

      {step === "codes" && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-amber-700">
            Save these recovery codes now. They will not be shown again.
          </p>
          <p className="text-sm">
            If you lose your authenticator, each code lets you sign in once.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded bg-bg-elevated p-3">
            {recoveryCodes.map((c) => (
              <code key={c} className="font-mono text-xs">
                {c}
              </code>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={downloadCodes}
              className="flex-1 rounded border px-3 py-2 text-sm"
            >
              Download .txt
            </button>
            <button
              type="button"
              onClick={() => void copyCodes()}
              className="flex-1 rounded border px-3 py-2 text-sm"
            >
              Copy all
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              onComplete();
              onClose();
            }}
            className="w-full rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white"
          >
            I&apos;ve saved these — Continue
          </button>
        </div>
      )}
    </ModalShell>
  );
}
