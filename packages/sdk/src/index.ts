export type {
  AddonPermission,
  AddonTargetEvent,
  AddonManifest,
  DataIngestPayload,
  ParsedJob,
  ParserError,
  ParserResult,
  JobfloAddon,
  ChartRenderOptions,
  ChartRequest,
  ChartError,
  ChartResult,
  JobfloChartAddon,
} from "./types";

import type { JobfloAddon, JobfloChartAddon } from "./types";

/**
 * Defines a Jobflo parser addon with full type inference and checking
 * against the `JobfloAddon` contract. Preferred over constructing the
 * object literal directly so the manifest and `parse` implementation stay
 * in sync.
 */
export function defineAddon(addon: JobfloAddon): JobfloAddon {
  return addon;
}

/**
 * Defines a Jobflo chart/visualization addon with full type inference and
 * checking against the `JobfloChartAddon` contract. Use this instead of
 * `defineAddon` when your addon turns already-parsed `ParsedJob[]` into a
 * rendered chart for the analytics section, rather than parsing raw
 * ingested content.
 */
export function defineChartAddon(addon: JobfloChartAddon): JobfloChartAddon {
  return addon;
}
