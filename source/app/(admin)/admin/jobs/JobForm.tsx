"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { JobRow } from "@/lib/supabase/jobs";
import type { ActionResult } from "@/lib/admin/action-result";
import SubmitButton from "@/components/admin/SubmitButton";

interface JobFormProps {
  /** Server action; useActionState contract. */
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  initial?: JobRow | null;
  submitLabel: string;
  /** Toast copy dispatched on a successful submit (e.g., "Job created"). */
  successCopy: string;
  /** Path to navigate to after a successful submit. */
  redirectTo: string;
}

const INITIAL_STATE: ActionResult = { ok: true };

export function JobForm({
  action,
  initial,
  submitLabel,
  successCopy,
  redirectTo,
}: JobFormProps) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  const submitted = useRef(false);

  useEffect(() => {
    if (!submitted.current) return;
    if (state.ok) {
      toast.success(successCopy);
      router.push(redirectTo);
    } else {
      toast.error(state.error);
    }
  }, [state, router, successCopy, redirectTo]);

  // JSONB columns can hold any shape; tolerate non-array values (e.g., a row
  // edited by hand to {} or a string) by falling back to empty rather than
  // crashing the editor render. Guards against unrecoverable form crashes
  // when the underlying DB value is not a proper array.
  const resp = Array.isArray(initial?.responsibilities)
    ? (initial.responsibilities as string[]).map((r) => `- ${r}`).join("\n")
    : "";
  const qual = Array.isArray(initial?.qualifications)
    ? (initial.qualifications as string[]).map((q) => `- ${q}`).join("\n")
    : "";

  const input =
    "w-full rounded-lg border border-border bg-bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent transition";
  const label = "block text-sm font-semibold text-text-primary mb-2";

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submitted.current = true;
      }}
      className="space-y-5 max-w-3xl"
    >
      <div>
        <label className={label} htmlFor="title">Title</label>
        <input id="title" name="title" type="text" required defaultValue={initial?.title ?? ""} className={input} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="slug">Slug</label>
          <input id="slug" name="slug" type="text" required defaultValue={initial?.slug ?? ""} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="sort_order">Sort order</label>
          <input id="sort_order" name="sort_order" type="number" defaultValue={initial?.sort_order ?? 0} className={input} />
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className={label} htmlFor="department">Department</label>
          <input id="department" name="department" type="text" required defaultValue={initial?.department ?? ""} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="type">Type</label>
          <input id="type" name="type" type="text" required defaultValue={initial?.type ?? "Full-Time"} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="location">Location</label>
          <input id="location" name="location" type="text" required defaultValue={initial?.location ?? "Remote"} className={input} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="summary">Summary</label>
        <textarea id="summary" name="summary" rows={3} required defaultValue={initial?.summary ?? ""} className={input} />
      </div>
      <div>
        <label className={label} htmlFor="responsibilities">
          Responsibilities (one per line; leading <code>-</code> optional)
        </label>
        <textarea id="responsibilities" name="responsibilities" rows={6} defaultValue={resp} className={input} />
      </div>
      <div>
        <label className={label} htmlFor="qualifications">Qualifications (one per line)</label>
        <textarea id="qualifications" name="qualifications" rows={6} defaultValue={qual} className={input} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="seo_title">SEO title (optional)</label>
          <input id="seo_title" name="seo_title" type="text" defaultValue={initial?.seo_title ?? ""} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="seo_description">SEO description (optional)</label>
          <input id="seo_description" name="seo_description" type="text" defaultValue={initial?.seo_description ?? ""} className={input} />
        </div>
      </div>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={initial ? initial.is_active : true}
          className="w-5 h-5 accent-accent"
        />
        <span className="text-text-primary font-medium">Active (visible on /careers)</span>
      </label>
      <SubmitButton pendingLabel={`${submitLabel}…`}>{submitLabel}</SubmitButton>
    </form>
  );
}
