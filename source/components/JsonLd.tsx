import { jsonLdScriptContent } from '@/lib/seo/json-ld'

/**
 * One `<script type="application/ld+json">` element, escaped so no field can
 * close it early. A server component: the data is in the HTML on first load,
 * where crawlers read it.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(data) }} />
}
