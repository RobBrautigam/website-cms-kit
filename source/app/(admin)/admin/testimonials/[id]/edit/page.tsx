import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchTestimonialById } from "@/lib/supabase/testimonials";
import { updateTestimonial } from "../../actions";
import { TestimonialForm } from "../../TestimonialForm";

export const dynamic = "force-dynamic";

export default async function EditTestimonialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const testimonial = await fetchTestimonialById(supabase, id);
  if (!testimonial) notFound();

  const boundUpdate = updateTestimonial.bind(null, id);

  return (
    <>
      <h1 className="text-2xl font-black mb-8" style={{ fontFamily: "var(--font-display)" }}>
        EDIT: {testimonial.name.toUpperCase()}
      </h1>
      <TestimonialForm action={boundUpdate} initial={testimonial} submitLabel="Update testimonial" successCopy="Testimonial saved" />
    </>
  );
}
