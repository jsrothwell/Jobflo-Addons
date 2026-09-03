/**
 * Permissions an addon may request. Addons are local-first: no permission
 * grants implicit network access, and each capability must be declared.
 */
export type AddonPermission =
  | "filesystem:read"
  | "filesystem:write"
  | "clipboard:read"
  | "network:fetch"
  | "notifications:show";

/**
 * Lifecycle / data events an addon can subscribe to.
 */
export type AddonTargetEvent =
  | "data:ingest"
  | "data:parse"
  | "job:created"
  | "job:updated"
  | "app:startup"
  | "analytics:render";

/**
 * Describes an addon: identity, versioning, and the capabilities/events it
 * needs to operate. Loaded and validated by the host before activation.
 */
export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: AddonPermission[];
  targetEvents: AddonTargetEvent[];
}

/**
 * Raw content handed to an addon for parsing, along with where it came from.
 */
export interface DataIngestPayload {
  rawContent: string;
  sourceType: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

/**
 * A single normalized job record produced by a parser.
 */
export interface ParsedJob {
  title: string;
  company: string;
  location?: string;
  description?: string;
  url?: string;
  postedAt?: string;
  [key: string]: unknown;
}

/**
 * An error encountered while parsing a payload. Non-fatal: parsers may
 * return partial results alongside one or more errors.
 */
export interface ParserError {
  message: string;
  code?: string;
  context?: Record<string, unknown>;
}

/**
 * The result of parsing a `DataIngestPayload`.
 */
export interface ParserResult {
  parsedJobs: ParsedJob[];
  errors: ParserError[];
  metadata: Record<string, unknown>;
}

/**
 * The contract every Jobflo parser addon must implement.
 */
export interface JobfloAddon {
  manifest: AddonManifest;
  parse: (payload: DataIngestPayload) => ParserResult | Promise<ParserResult>;
}

/**
 * Host-supplied rendering hints for a chart addon. All optional — a chart
 * addon should apply sensible defaults for any that are absent, since the
 * host is not required to supply them.
 */
export interface ChartRenderOptions {
  width?: number;
  height?: number;
  theme?: "light" | "dark";
  [key: string]: unknown;
}

/**
 * Input handed to a chart addon: the normalized job records to visualize
 * (typically the output of one or more parser addons' `ParsedJob[]`,
 * aggregated by the host), plus rendering hints.
 */
export interface ChartRequest {
  jobs: ParsedJob[];
  options?: ChartRenderOptions;
}

/**
 * An error encountered while rendering a chart. Non-fatal where possible: a
 * chart addon may still return a partial or placeholder `content` alongside
 * one or more errors (e.g. "no data for the selected range").
 */
export interface ChartError {
  message: string;
  code?: string;
  context?: Record<string, unknown>;
}

/**
 * The rendered output of a chart addon. `content` must be a self-contained
 * string in the given `format` — no external network requests and no
 * relative asset paths — since the host renders it directly with no
 * further fetching. `format: "svg"` should be a bare `<svg>...</svg>`
 * document; `format: "html"` may additionally include inline `<style>`
 * and non-network `<script>` for interactivity.
 */
export interface ChartResult {
  format: "svg" | "html";
  content: string;
  title?: string;
  errors: ChartError[];
  metadata: Record<string, unknown>;
}

/**
 * The contract every Jobflo chart/visualization addon must implement.
 * Distinct from `JobfloAddon`: instead of turning raw ingested content into
 * `ParsedJob`s, a chart addon turns already-parsed `ParsedJob`s into a
 * rendered visualization for the analytics section. Declare
 * `"analytics:render"` in the manifest's `targetEvents` so the host knows
 * to offer it there.
 */
export interface JobfloChartAddon {
  manifest: AddonManifest;
  render: (request: ChartRequest) => ChartResult | Promise<ChartResult>;
}
