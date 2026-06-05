"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Testimonial } from "@/lib/supabase/testimonials";
import type { ActionResult } from "@/lib/admin/action-result";
import ImageUploader from "@/components/admin/ImageUploader";
import SubmitButton from "@/components/admin/SubmitButton";

interface TestimonialFormProps {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  initial?: Testimonial | null;
  submitLabel: string;
  /** Toast copy on success (e.g., "Testimonial created"). */
  successCopy: string;
}

const INITIAL_STATE: ActionResult = { ok: true };

const SOURCE_OPTIONS = ["direct", "trustpilot", "manual", "google", "capterra", "linkedin"];

export function TestimonialForm({ action, initial, submitLabel, successCopy }: TestimonialFormProps) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  const submitted = useRef(false);
  const [kind, setKind] = useState<"text" | "video">(initial?.kind ?? "text");
  const [headshotUrl, setHeadshotUrl] = useState(initial?.headshot_url ?? "");
  const [screenshotUrl, setScreenshotUrl] = useState(initial?.screenshot_url ?? "");

  useEffect(() => {
    if (!submitted.current) return;
    if (state.ok) {
      toast.success(successCopy);
      router.push("/admin/testimonials");
    } else {
      toast.error(state.error);
    }
  }, [state, router, successCopy]);

  const input =
    "w-full rounded-lg border border-border bg-bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent transition";
  const label = "block text-sm font-semibold text-text-primary mb-2";

  const initialReceived = initial?.received_at
    ? new Date(initial.received_at).toISOString().slice(0, 10)
    : "";

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submitted.current = true;
      }}
      className="space-y-5 max-w-3xl"
    >
      <input type="hidden" name="headshot_url" value={headshotUrl} />
      <input type="hidden" name="screenshot_url" value={screenshotUrl} />

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className={label} htmlFor="kind">Kind</label>
          <select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "text" | "video")}
            className={input}
          >
            <option value="text">Text</option>
            <option value="video">Video</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="source">Source</label>
          <select
            id="source"
            name="source"
            defaultValue={initial?.source ?? "manual"}
            className={input}
          >
            {SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="rating">Rating (1–5, blank for none)</label>
          <input
            id="rating"
            name="rating"
            type="number"
            min={1}
            max={5}
            defaultValue={initial?.rating ?? 5}
            className={input}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="name">Name</label>
          <input id="name" name="name" type="text" required defaultValue={initial?.name ?? ""} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="tagline">Tagline / role</label>
          <input
            id="tagline"
            name="tagline"
            type="text"
            placeholder="e.g., Fractional COO"
            defaultValue={initial?.tagline ?? ""}
            className={input}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="company">Company</label>
        <input id="company" name="company" type="text" defaultValue={initial?.company ?? ""} className={input} />
      </div>

      <ImageUploader
        currentUrl={headshotUrl}
        onUpload={setHeadshotUrl}
        label="Headshot"
      />

      <ImageUploader
        currentUrl={screenshotUrl}
        onUpload={setScreenshotUrl}
        label="Screenshot (optional, text testimonials only)"
      />

      <div>
        <label className={label} htmlFor="headline">Headline (optional)</label>
        <input
          id="headline"
          name="headline"
          type="text"
          placeholder="Optional title or pull-quote header"
          defaultValue={initial?.headline ?? ""}
          className={input}
        />
      </div>

      <div>
        <label className={label} htmlFor="quote">
          Quote <span className="text-xs text-text-secondary">(allowed HTML: &lt;strong&gt;, &lt;em&gt;, &lt;mark&gt;, &lt;br&gt;)</span>
        </label>
        <textarea
          id="quote"
          name="quote"
          rows={5}
          required
          defaultValue={initial?.quote ?? ""}
          className={input}
        />
      </div>

      <div>
        <label className={label} htmlFor="external_url">Source URL (legacy / TrustPilot)</label>
        <input
          id="external_url"
          name="external_url"
          type="url"
          defaultValue={initial?.external_url ?? ""}
          className={input}
        />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted">Submitter contact</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className={label} htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              defaultValue={initial?.email ?? ""}
              className={input}
              placeholder="jane@example.com"
            />
          </div>
          <div>
            <label className={label} htmlFor="website_url">Website URL</label>
            <input
              id="website_url"
              name="website_url"
              type="url"
              defaultValue={initial?.website_url ?? ""}
              className={input}
              placeholder="https://example.com"
            />
          </div>
          <div>
            <label className={label} htmlFor="linkedin_url">LinkedIn URL</label>
            <input
              id="linkedin_url"
              name="linkedin_url"
              type="url"
              defaultValue={initial?.linkedin_url ?? ""}
              className={input}
              placeholder="https://linkedin.com/in/jane"
            />
          </div>
        </div>
      </div>

      {kind === "video" && (
        <div className="space-y-4 p-4 rounded-lg border border-border bg-bg-elevated">
          <h3 className="text-sm font-bold uppercase tracking-wider text-accent">Video</h3>
          <div>
            <label className={label} htmlFor="video_url">Video URL (Supabase Storage MP4)</label>
            <input
              id="video_url"
              name="video_url"
              type="url"
              defaultValue={initial?.video_url ?? ""}
              className={input}
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="video_thumbnail_url">Thumbnail URL</label>
              <input
                id="video_thumbnail_url"
                name="video_thumbnail_url"
                type="url"
                defaultValue={initial?.video_thumbnail_url ?? ""}
                className={input}
              />
            </div>
            <div>
              <label className={label} htmlFor="video_aspect_ratio">Aspect ratio</label>
              <input
                id="video_aspect_ratio"
                name="video_aspect_ratio"
                type="text"
                placeholder="16:9"
                defaultValue={initial?.video_aspect_ratio ?? ""}
                className={input}
              />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="video_duration_sec">Duration (seconds)</label>
            <input
              id="video_duration_sec"
              name="video_duration_sec"
              type="number"
              step="0.01"
              defaultValue={initial?.video_duration_sec ?? ""}
              className={input}
            />
          </div>
          <div>
            <label className={label} htmlFor="video_transcript">Transcript (used for SEO + a11y captions)</label>
            <textarea
              id="video_transcript"
              name="video_transcript"
              rows={5}
              defaultValue={initial?.video_transcript ?? ""}
              className={input}
            />
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="received_at">Received date</label>
          <input
            id="received_at"
            name="received_at"
            type="date"
            defaultValue={initialReceived}
            className={input}
          />
        </div>
        <div>
          <label className={label} htmlFor="display_order">Display order (lower = earlier)</label>
          <input
            id="display_order"
            name="display_order"
            type="number"
            defaultValue={initial?.display_order ?? 0}
            className={input}
          />
        </div>
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          name="is_visible"
          defaultChecked={initial?.is_visible ?? false}
          className="w-5 h-5 accent-accent"
        />
        <span className="text-text-primary font-medium">Visible on /results</span>
      </label>

      <SubmitButton className="btn-primary px-6 py-3 font-bold" pendingLabel={`${submitLabel}…`}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
