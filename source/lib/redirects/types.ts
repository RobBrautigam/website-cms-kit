/**
 * Shared types for the URL redirect manager. Used by both the proxy lookup
 * (Edge runtime) and the admin UI (Node runtime).
 */

export interface UrlRedirect {
  id: string;
  source: string;          // canonical, no trailing slash
  is_pattern: boolean;
  destination: string;     // absolute URL or absolute path
  permanent: boolean;      // 308 vs 307
  enabled: boolean;
  category: string | null;
  notes: string | null;
  hit_count: number;
  last_access: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompiledPattern {
  regex: RegExp;
  paramNames: string[];   // names in order of capture groups
  hasWildcard: boolean;   // true if any param ended with *
}

export interface PatternRedirect extends UrlRedirect {
  compiled: CompiledPattern;
}

export interface RedirectMatch {
  id: string;
  destination: string;     // resolved (params substituted if pattern)
  permanent: boolean;
}
