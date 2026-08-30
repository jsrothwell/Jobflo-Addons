export type {
  AddonPermission,
  AddonTargetEvent,
  AddonManifest,
  DataIngestPayload,
  ParsedJob,
  ParserError,
  ParserResult,
  JobfloAddon,
} from "./types";

import type { JobfloAddon } from "./types";

/**
 * Defines a Jobflo addon with full type inference and checking against the
 * `JobfloAddon` contract. Preferred over constructing the object literal
 * directly so the manifest and `parse` implementation stay in sync.
 */
export function defineAddon(addon: JobfloAddon): JobfloAddon {
  return addon;
}
