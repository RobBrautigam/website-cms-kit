"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { UrlRedirect } from "@/lib/redirects/types";
import type { ActionResult } from "@/lib/admin/action-result";
import SubmitButton from "@/components/admin/SubmitButton";

interface Props {
  mode: "create" | "edit";
  initial?: Partial<UrlRedirect>;
  categories: string[];
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** Toast copy on success. */
  successCopy: string;
}

const INITIAL_STATE: ActionResult = { ok: true };

export default function RedirectForm({
  mode,
  initial,
  categories,
  action,
  successCopy,
}: Props) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  const submitted = useRef(false);
  const [source, setSource] = useState(initial?.source ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(
    initial?.category != null && !categories.includes(initial.category)
  );

  useEffect(() => {
    if (!submitted.current) return;
    if (state.ok) {
      toast.success(successCopy);
      router.push("/admin/redirects");
    } else {
      toast.error(state.error);
    }
  }, [state, router, successCopy]);

  const isPattern = source.includes(":");

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submitted.current = true;
      }}
      className="max-w-2xl space-y-6"
    >
      <div>
        <label className="block text-xs uppercase text-text-muted mb-1" htmlFor="source">Source path</label>
        <input
          id="source" name="source" type="text" required
          defaultValue={initial?.source ?? ""}
          onChange={(e) => setSource(e.target.value)}
          placeholder="/example or /clients/:slug or /blog/:path*"
          className="w-full px-3 py-2 font-mono text-sm border border-border rounded-md bg-bg-white"
        />
        {isPattern && (
          <p className="mt-1 text-xs text-accent">
            Pattern detected. <code>:slug</code> matches a single path segment; <code>:path*</code> matches any number of segments.
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs uppercase text-text-muted mb-1" htmlFor="destination">Destination</label>
        <input
          id="destination" name="destination" type="text" required
          defaultValue={initial?.destination ?? ""}
          placeholder="https://… or /relative-path"
          className="w-full px-3 py-2 font-mono text-sm border border-border rounded-md bg-bg-white"
        />
      </div>

      <div>
        <label className="block text-xs uppercase text-text-muted mb-1">Type</label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="permanent" value="true" defaultChecked={initial?.permanent ?? true} />
            Permanent (308)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="permanent" value="false" defaultChecked={initial?.permanent === false} />
            Temporary (307)
          </label>
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase text-text-muted mb-1" htmlFor="category">Category</label>
        {!showNewCategoryInput ? (
          <div className="flex gap-2">
            <select
              id="category" name="category" value={category ?? ""}
              onChange={(e) => setCategory(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-bg-white"
            >
              <option value="">(none)</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { setShowNewCategoryInput(true); setCategory(""); }}
              className="px-3 py-2 text-xs border border-border rounded-md hover:bg-bg-elevated"
            >
              + New
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text" name="category" defaultValue={category ?? ""}
              placeholder="my-category"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-bg-white"
            />
            <button
              type="button"
              onClick={() => setShowNewCategoryInput(false)}
              className="px-3 py-2 text-xs border border-border rounded-md hover:bg-bg-elevated"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs uppercase text-text-muted mb-1" htmlFor="notes">Notes</label>
        <textarea
          id="notes" name="notes" rows={3}
          defaultValue={initial?.notes ?? ""}
          placeholder="Why does this redirect exist? Future maintainers will thank you."
          className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-white"
        />
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={initial?.enabled ?? true} />
          Enabled (disabled redirects fall through to normal Next.js routing)
        </label>
      </div>

      {mode === "edit" && initial && (
        <div className="rounded-md border border-border bg-bg-elevated/40 px-4 py-3 text-xs text-text-secondary space-y-1">
          <div>Hits: <span className="tabular-nums font-semibold">{initial.hit_count?.toLocaleString() ?? 0}</span></div>
          <div>Last hit: {initial.last_access ?? "—"}</div>
          <div>Created: {initial.created_at ?? "—"}</div>
          <div>Updated: {initial.updated_at ?? "—"}</div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <SubmitButton
          className="btn-primary px-6 py-2.5 text-sm font-bold"
          pendingLabel="Saving…"
        >
          {mode === "create" ? "Create" : "Save"}
        </SubmitButton>
        <Link href="/admin/redirects" className="text-sm text-text-secondary hover:text-text-primary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
