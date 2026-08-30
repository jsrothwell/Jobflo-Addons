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
  | "app:startup";

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
 * The contract every Jobflo addon must implement.
 */
export interface JobfloAddon {
  manifest: AddonManifest;
  parse: (payload: DataIngestPayload) => ParserResult | Promise<ParserResult>;
}
