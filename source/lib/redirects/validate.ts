import { z } from "zod";

const sourceSchema = z
  .string()
  .min(1, "Source is required")
  .startsWith("/", "Source must start with /")
  .regex(/^\/[^?#]*$/, "No query strings or fragments")
  .transform((s) => (s.length > 1 ? s.replace(/\/$/, "") : s));

const destinationSchema = z
  .string()
  .min(1, "Destination is required")
  .refine(
    (d) => d.startsWith("/") || /^https?:\/\//.test(d),
    "Must be an absolute path (/foo) or absolute URL (https://...)"
  );

const emptyToNull = (v: unknown) => {
  if (typeof v !== "string") return v ?? null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
};

export const redirectInputSchema = z
  .object({
    source: sourceSchema,
    destination: destinationSchema,
    permanent: z.boolean().default(true),
    enabled: z.boolean().default(true),
    category: z.preprocess(emptyToNull, z.string().max(50).nullable()).default(null),
    notes: z.preprocess(emptyToNull, z.string().max(2000).nullable()).default(null),
  })
  .transform((data) => ({
    ...data,
    is_pattern: data.source.includes(":"),
  }))
  .refine(
    (data) => !(data.is_pattern && /^https?:\/\//.test(data.destination)),
    {
      // Pattern + external destination is blocked to keep the open-redirect
      // surface area small: a substituted external URL whose params come
      // from the request path is an open redirect by construction. If
      // genuinely needed, add a strict allowlist on the destination host
      // before lifting this rule.
      message:
        "Pattern redirects (source contains ':') cannot point to an external URL. Use a static source instead.",
      path: ["destination"],
    }
  );

export type RedirectInput = z.infer<typeof redirectInputSchema>;
