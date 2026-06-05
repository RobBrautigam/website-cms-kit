"use client";

import { useState } from "react";
import { toast } from "sonner";
import { TwoFactorEnrollmentModal } from "./TwoFactorEnrollmentModal";
import ConfirmDialog from "./ConfirmDialog";
import ModalShell from "./ModalShell";

interface MFAFactor {
  id: string;
  status: string;
  created_at: string;
  factor_type?: string;
  friendly_name?: string;
}

export function TwoFactorSection({
  initialFactors,
}: {
  initialFactors: MFAFactor[];
}) {
  const [factors, setFactors] = useState(initialFactors);
  const [enrolling, setEnrolling] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const totp = factors.find((f) => f.status === "verified");

  const refresh = async () => {
    const res = await fetch("/api/admin/mfa/list-factors");
    if (res.ok) {
      const data = (await res.json()) as MFAFactor[];
      setFactors(data);
    }
  };

  const onDisable = async () => {
    if (!totp) return;
    setBusy(true);
    const res = await fetch("/api/admin/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factor_id: totp.id, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const json = (await res.json()) as { error: string };
      toast.error(json.error);
      return;
    }
    setConfirmDisable(false);
    setPassword("");
    toast.success("Two-factor authentication disabled");
    void refresh();
  };

  const onRegenerate = async () => {
    setBusy(true);
    const res = await fetch("/api/admin/mfa/regenerate-codes", {
      method: "POST",
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Could not regenerate codes");
      return;
    }
    const json = (await res.json()) as { recovery_codes: string[] };
    setConfirmRegenerate(false);
    setNewCodes(json.recovery_codes);
  };

  const downloadCodes = (codes: string[]) => {
    const blob = new Blob(
      [
        `Acme admin recovery codes\nGenerated: ${new Date().toISOString()}\n\n${codes.join("\n")}\n`,
      ],
      { type: "text/plain" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `acme-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyCodes = async (codes: string[]) => {
    await navigator.clipboard.writeText(codes.join("\n"));
    toast.success("Recovery codes copied");
  };

  return (
    <>
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary/60 mb-3">
          Two-factor authentication
        </h2>
        <div className="border border-border rounded-xl divide-y divide-border">
          <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs text-text-secondary uppercase tracking-wider mb-0.5">
                Status
              </p>
              {totp ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
                    Enrolled
                  </span>
                  <span className="text-xs text-text-secondary">
                    Added {new Date(totp.created_at).toLocaleDateString()}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700">
                    Not enrolled
                  </span>
                </div>
              )}
              <p className="text-[11px] text-text-secondary/70 mt-1.5 leading-snug">
                {totp
                  ? "Your account is protected by an authenticator app."
                  : "Add an authenticator app (Authy, 1Password, Google Authenticator) for an extra layer of security."}
              </p>
            </div>
          </div>

          <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            {totp ? (
              <>
                <div className="min-w-0">
                  <p className="text-xs text-text-secondary uppercase tracking-wider mb-0.5">
                    Manage
                  </p>
                  <p className="text-sm text-text-primary">
                    Disable 2FA or regenerate your recovery codes.
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setConfirmRegenerate(true)}
                    className="px-4 py-2 rounded-lg border border-border text-text-primary text-sm font-medium hover:bg-bg-card transition-colors"
                  >
                    New recovery codes
                  </button>
                  <button
                    onClick={() => setConfirmDisable(true)}
                    className="px-4 py-2 rounded-lg border border-border text-text-primary text-sm font-medium hover:bg-bg-card transition-colors"
                  >
                    Disable 2FA
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="text-xs text-text-secondary uppercase tracking-wider mb-0.5">
                    Set up
                  </p>
                  <p className="text-sm text-text-primary">
                    Scan a QR code with your authenticator.
                  </p>
                </div>
                <button
                  onClick={() => setEnrolling(true)}
                  className="px-4 py-2 rounded-lg bg-text-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Enable 2FA
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {enrolling && (
        <TwoFactorEnrollmentModal
          onClose={() => setEnrolling(false)}
          onComplete={() => {
            void refresh();
          }}
        />
      )}

      {confirmDisable && (
        <ModalShell
          onClose={() => {
            if (!busy) {
              setConfirmDisable(false);
              setPassword("");
            }
          }}
          ariaLabelledBy="disable-2fa-title"
        >
          <h2 id="disable-2fa-title" className="text-xl font-bold mb-2">
            Disable two-factor authentication
          </h2>
          <p className="text-sm text-text-secondary mb-4">
            This reduces your account security. Confirm with your password.
          </p>
          <input
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-border px-3 py-2 text-sm mb-4"
            disabled={busy}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmDisable(false);
                setPassword("");
              }}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-border text-text-primary text-sm font-medium hover:bg-bg-card transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onDisable()}
              disabled={busy || !password}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {busy ? "Disabling…" : "Disable 2FA"}
            </button>
          </div>
        </ModalShell>
      )}

      {confirmRegenerate && (
        <ConfirmDialog
          title="Regenerate recovery codes?"
          description="Your old recovery codes will stop working immediately. You'll need to save the new ones somewhere safe."
          confirmLabel="Regenerate"
          confirmTone="primary"
          pending={busy}
          onConfirm={() => void onRegenerate()}
          onClose={() => setConfirmRegenerate(false)}
        />
      )}

      {newCodes && (
        <ModalShell
          onClose={() => {
            if (
              window.confirm(
                "Have you saved these new codes? They will not be shown again."
              )
            ) {
              setNewCodes(null);
            }
          }}
          ariaLabelledBy="new-codes-title"
        >
          <h2 id="new-codes-title" className="text-xl font-bold mb-2">
            New recovery codes
          </h2>
          <p className="text-sm font-semibold text-amber-700 mb-3">
            Save these now. Your old codes are no longer valid.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded bg-bg-elevated p-3 mb-4">
            {newCodes.map((c) => (
              <code key={c} className="font-mono text-xs">
                {c}
              </code>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => downloadCodes(newCodes)}
              className="flex-1 rounded border px-3 py-2 text-sm"
            >
              Download .txt
            </button>
            <button
              type="button"
              onClick={() => void copyCodes(newCodes)}
              className="flex-1 rounded border px-3 py-2 text-sm"
            >
              Copy all
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNewCodes(null)}
            className="w-full mt-3 rounded-lg bg-text-primary text-white px-4 py-2 text-sm font-medium"
          >
            I&apos;ve saved them — Continue
          </button>
        </ModalShell>
      )}
    </>
  );
}
