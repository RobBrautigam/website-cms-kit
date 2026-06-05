import Link from "next/link";
import Image from "next/image";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require";
import { fetchAllTestimonials } from "@/lib/supabase/testimonials";
import RowDeleteButton from "@/components/admin/RowDeleteButton";
import ToggleButton from "@/components/admin/ToggleButton";
import { deleteTestimonial, toggleTestimonialVisible } from "./actions";

export const dynamic = "force-dynamic";

function StarRating({ value }: { value: number | null }) {
  if (!value) return <span className="text-text-secondary">—</span>;
  return (
    <span className="text-amber-500" aria-label={`${value} out of 5`}>
      {"★".repeat(value)}
      <span className="text-border">{"★".repeat(5 - value)}</span>
    </span>
  );
}

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "video" | "warning" }) {
  const tones: Record<string, string> = {
    default: "bg-bg-elevated text-text-secondary",
    video: "bg-accent/15 text-accent",
    warning: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default async function AdminTestimonialsPage() {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const rows = await fetchAllTestimonials(supabase);

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-black" style={{ fontFamily: "var(--font-display)" }}>
          TESTIMONIALS
        </h1>
        <Link
          href="/admin/testimonials/new"
          className="btn-primary px-5 py-2.5 text-sm font-bold"
        >
          + New Testimonial
        </Link>
      </div>

      <div className="hidden md:block border border-border rounded-lg overflow-hidden bg-bg-white">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated border-b border-border">
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted">
              <th className="px-3 py-3 w-14"></th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Kind</th>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Rating</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Visible</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((t) => {
              const thumb = t.kind === "video" ? t.video_thumbnail_url : t.headshot_url;
              const enrichmentMissing =
                !t.headshot_url || !t.tagline || !t.company;
              return (
                <tr key={t.id} className="hover:bg-bg-elevated/50">
                  <td className="px-3 py-3">
                    {thumb ? (
                      <Image src={thumb} alt={t.name} width={40} height={40} className="rounded-md object-cover w-10 h-10" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-bg-elevated flex items-center justify-center text-text-muted text-xs">—</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-text-primary">{t.name}</div>
                    <div className="text-xs text-text-secondary">
                      {[t.tagline, t.company].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {t.kind === "video" ? <Chip tone="video">video</Chip> : <Chip>text</Chip>}
                  </td>
                  <td className="px-3 py-3"><Chip>{t.source}</Chip></td>
                  <td className="px-3 py-3"><StarRating value={t.rating} /></td>
                  <td className="px-3 py-3">
                    {enrichmentMissing && <Chip tone="warning">enrich</Chip>}
                  </td>
                  <td className="px-3 py-3">
                    <ToggleButton
                      currentValue={t.is_visible}
                      onLabel="Visible"
                      offLabel="Hidden"
                      onClass="bg-green-100 text-green-700"
                      offClass="bg-gray-100 text-gray-500"
                      action={toggleTestimonialVisible.bind(null, t.id)}
                      onSuccessCopy="Testimonial shown"
                      offSuccessCopy="Testimonial hidden"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/testimonials/${t.id}/edit`} className="text-accent hover:underline">
                        Edit
                      </Link>
                      <RowDeleteButton
                        action={deleteTestimonial.bind(null, t.id)}
                        itemLabel={t.name}
                        successCopy={`Testimonial deleted: ${t.name}`}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <ul className="md:hidden space-y-3">
        {rows.map((t) => {
          const thumb = t.kind === "video" ? t.video_thumbnail_url : t.headshot_url;
          const enrichmentMissing =
            !t.headshot_url || !t.tagline || !t.company;
          return (
            <li
              key={t.id}
              className="border border-border rounded-lg bg-bg-white p-4"
            >
              <div className="flex items-start gap-3">
                {thumb ? (
                  <Image src={thumb} alt={t.name} width={48} height={48} className="rounded-md object-cover w-12 h-12 shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-bg-elevated flex items-center justify-center text-text-muted text-xs shrink-0">—</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text-primary truncate">{t.name}</p>
                  <p className="text-xs text-text-secondary truncate">
                    {[t.tagline, t.company].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold mb-1">Kind</p>
                  {t.kind === "video" ? <Chip tone="video">video</Chip> : <Chip>text</Chip>}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold mb-1">Source</p>
                  <Chip>{t.source}</Chip>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold mb-1">Rating</p>
                  <StarRating value={t.rating} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold mb-1">Visible</p>
                  <ToggleButton
                    currentValue={t.is_visible}
                    onLabel="Visible"
                    offLabel="Hidden"
                    onClass="bg-green-100 text-green-700"
                    offClass="bg-gray-100 text-gray-500"
                    action={toggleTestimonialVisible.bind(null, t.id)}
                    onSuccessCopy="Testimonial shown"
                    offSuccessCopy="Testimonial hidden"
                  />
                </div>
                {enrichmentMissing && (
                  <div className="col-span-2">
                    <Chip tone="warning">enrich</Chip>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Link
                  href={`/admin/testimonials/${t.id}/edit`}
                  className="flex-1 flex items-center justify-center px-3 py-2 rounded-lg border border-border text-sm font-semibold text-text-primary hover:text-accent hover:bg-accent/10 transition-colors"
                >
                  Edit
                </Link>
                <RowDeleteButton
                  action={deleteTestimonial.bind(null, t.id)}
                  itemLabel={t.name}
                  successCopy={`Testimonial deleted: ${t.name}`}
                  className="px-3 py-2 rounded-lg border border-border text-sm font-semibold text-text-secondary hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors"
                />
              </div>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && (
        <p className="text-center text-text-muted mt-8">
          No testimonials yet. Click &quot;+ New Testimonial&quot; to create one.
        </p>
      )}
    </>
  );
}
