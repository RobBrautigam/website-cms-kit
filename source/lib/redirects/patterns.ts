import type { CompiledPattern } from "./types";

/**
 * Compile a redirect source string with optional :param and :path* placeholders
 * into a regex with capture groups.
 *
 * Single-segment param: ":name"  -> "([^/]+)"
 * Wildcard param:        ":name*" -> "(.+)"
 * Literal segments are regex-escaped to handle URL paths containing '.', etc.
 */
export function compilePattern(source: string): CompiledPattern {
  const paramNames: string[] = [];
  let hasWildcard = false;

  const parts = source.split(/(:[a-zA-Z_]\w*\*?)/);
  let pattern = "";
  for (const part of parts) {
    if (!part) continue;
    const m = part.match(/^:(\w+)(\*?)$/);
    if (m) {
      paramNames.push(m[1]);
      if (m[2] === "*") {
        hasWildcard = true;
        pattern += "(.+)";
      } else {
        pattern += "([^/]+)";
      }
    } else {
      pattern += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  return {
    regex: new RegExp(`^${pattern}$`),
    paramNames,
    hasWildcard,
  };
}

/**
 * Try matching `pathname` against `compiled`. If it matches, substitute the
 * captured params into `destinationTemplate` and return the resolved string.
 * Otherwise return null.
 *
 * Wildcard params (`:name*`) are substituted by their wildcard form in the
 * destination template (e.g., destination `/section/:path*` with capture
 * "foo/bar" -> "/section/foo/bar").
 */
export function matchAndSubstitute(
  pathname: string,
  compiled: CompiledPattern,
  destinationTemplate: string
): string | null {
  const m = pathname.match(compiled.regex);
  if (!m) return null;
  let dest = destinationTemplate;
  compiled.paramNames.forEach((name, i) => {
    if (dest.includes(`:${name}*`)) {
      dest = dest.replace(`:${name}*`, m[i + 1]);
    } else if (dest.includes(`:${name}`)) {
      dest = dest.replace(`:${name}`, m[i + 1]);
    }
  });
  return dest;
}
