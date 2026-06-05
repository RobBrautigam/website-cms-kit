import { createTestimonial } from "../actions";
import { TestimonialForm } from "../TestimonialForm";

export default function NewTestimonialPage() {
  return (
    <>
      <h1 className="text-2xl font-black mb-8" style={{ fontFamily: "var(--font-display)" }}>
        NEW TESTIMONIAL
      </h1>
      <TestimonialForm action={createTestimonial} submitLabel="Create testimonial" successCopy="Testimonial created" />
    </>
  );
}
