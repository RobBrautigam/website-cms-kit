/**
 * Password complexity check for admin password set/reset.
 *
 * Three categories — letter (any case) / number / symbol — plus a 12-char
 * minimum. Aligned with NIST SP 800-63B updated guidance which favors
 * length over arcane composition rules. We don't distinguish lowercase vs
 * uppercase because requiring both adds friction without meaningfully
 * changing entropy at 12+ chars.
 */

export const MIN_PASSWORD_LENGTH = 12

export interface PasswordRequirement {
  id: 'length' | 'letter' | 'number' | 'symbol'
  label: string
  test: (password: string) => boolean
}

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  {
    id: 'length',
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (p) => p.length >= MIN_PASSWORD_LENGTH,
  },
  { id: 'letter', label: 'Includes a letter', test: (p) => /[a-zA-Z]/.test(p) },
  { id: 'number', label: 'Includes a number', test: (p) => /[0-9]/.test(p) },
  { id: 'symbol', label: 'Includes a symbol', test: (p) => /[^a-zA-Z0-9]/.test(p) },
]

export interface PasswordCheckResult {
  ok: boolean
  reason?: string
  /** Per-requirement satisfaction so UI can render a checklist. */
  checks: { id: PasswordRequirement['id']; met: boolean; label: string }[]
}

export function checkPasswordStrength(password: string): PasswordCheckResult {
  const safe = typeof password === 'string' ? password : ''
  const checks = PASSWORD_REQUIREMENTS.map((r) => ({
    id: r.id,
    label: r.label,
    met: r.test(safe),
  }))
  const ok = checks.every((c) => c.met)

  if (!ok) {
    const missing = checks.filter((c) => !c.met).map((c) => c.label.toLowerCase())
    return {
      ok: false,
      reason: `Password needs: ${missing.join(', ')}.`,
      checks,
    }
  }

  return { ok: true, checks }
}
