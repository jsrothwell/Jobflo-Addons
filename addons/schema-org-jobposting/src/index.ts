import { defineAddon, type ParsedJob, type ParserError } from "@jobflo/addon-sdk";

/**
 * schema.org JobPosting addon.
 *
 * Most ATS platforms (Greenhouse, Lever, Workday, SmartRecruiters, LinkedIn,
 * Indeed, and countless company career pages) embed a JobPosting JSON-LD
 * block in their page HTML purely for search-engine rich results. That block
 * is already a normalized, machine-readable job record — this addon reads
 * it directly instead of scraping site-specific markup, so it works across
 * any site that follows the standard rather than one source at a time.
 *
 * Feed it the HTML source of a job posting page (View Source / Save Page,
 * copied into rawContent) and it extracts every JobPosting node it can find.
 */

const JSON_LD_SCRIPT_RE =
  /<script[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const MAX_WALK_DEPTH = 25;

/** Pulls the raw text content of every JSON-LD <script> block out of an HTML document. */
function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  JSON_LD_SCRIPT_RE.lastIndex = 0;
  while ((match = JSON_LD_SCRIPT_RE.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (raw) {
      blocks.push(raw);
    }
  }

  return blocks;
}

function hasJobPostingType(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  if (typeof type === "string") {
    return type === "JobPosting";
  }
  if (Array.isArray(type)) {
    return type.some((t) => t === "JobPosting");
  }
  return false;
}

/** Recursively walks a parsed JSON-LD value (object, array, or @graph) collecting JobPosting nodes. */
function collectJobPostings(
  value: unknown,
  results: Record<string, unknown>[],
  depth = 0,
): void {
  if (depth > MAX_WALK_DEPTH || value == null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectJobPostings(item, results, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const node = value as Record<string, unknown>;

  if (hasJobPostingType(node)) {
    results.push(node);
  }

  for (const key of Object.keys(node)) {
    collectJobPostings(node[key], results, depth + 1);
  }
}

/** hiringOrganization can be a string, an Organization object, or (rarely) an array of either. */
function extractCompany(node: Record<string, unknown>): string | undefined {
  const org = node["hiringOrganization"];
  return extractName(org);
}

function extractName(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = extractName(item);
      if (name) return name;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const name = (value as Record<string, unknown>)["name"];
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  }
  return undefined;
}

/** Renders a PostalAddress (or plain string) into a single human-readable location string. */
function formatAddress(address: unknown): string | undefined {
  if (typeof address === "string" && address.trim()) {
    return address.trim();
  }
  if (address && typeof address === "object") {
    const a = address as Record<string, unknown>;
    const parts = [a["addressLocality"], a["addressRegion"], a["addressCountry"]]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .map((p) => p.trim());
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  return undefined;
}

/** jobLocation may be a single Place, an array of Places, or absent for remote roles. */
function extractLocation(node: Record<string, unknown>): string | undefined {
  const jobLocationType = node["jobLocationType"];
  const jobLocation = node["jobLocation"];

  const locations: string[] = [];
  const places = Array.isArray(jobLocation) ? jobLocation : jobLocation ? [jobLocation] : [];

  for (const place of places) {
    if (place && typeof place === "object") {
      const formatted = formatAddress((place as Record<string, unknown>)["address"] ?? place);
      if (formatted && !locations.includes(formatted)) {
        locations.push(formatted);
      }
    } else if (typeof place === "string" && place.trim()) {
      locations.push(place.trim());
    }
  }

  if (locations.length > 0) {
    return locations.join("; ");
  }

  if (typeof jobLocationType === "string" && jobLocationType.toUpperCase() === "TELECOMMUTE") {
    return "Remote";
  }

  return undefined;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** JobPosting descriptions are HTML fragments; strip tags and decode common entities for plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-zA-Z#0-9]+;/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function extractUrl(node: Record<string, unknown>): string | undefined {
  const url = node["url"];
  if (typeof url === "string" && url.trim()) {
    return url.trim();
  }
  return undefined;
}

function extractPostedAt(node: Record<string, unknown>): string | undefined {
  const posted = node["datePosted"];
  if (typeof posted === "string" && posted.trim()) {
    return posted.trim();
  }
  return undefined;
}

export default defineAddon({
  manifest: {
    id: "schema-org-jobposting",
    name: "schema.org JobPosting",
    version: "1.0.0",
    description:
      "Extracts schema.org JobPosting JSON-LD from pasted job page HTML and normalizes it into Jobflo jobs.",
    author: "jsrothwell",
    permissions: ["clipboard:read"],
    targetEvents: ["data:ingest"],
  },

  parse(payload) {
    const parsedJobs: ParsedJob[] = [];
    const errors: ParserError[] = [];

    const blocks = extractJsonLdBlocks(payload.rawContent);

    if (blocks.length === 0) {
      errors.push({
        message:
          'No JSON-LD found. Paste the full HTML source of the job page (it must include a <script type="application/ld+json"> block).',
        code: "NO_JSON_LD",
      });
      return { parsedJobs, errors, metadata: { sourceType: payload.sourceType, blockCount: 0 } };
    }

    const jobPostingNodes: Record<string, unknown>[] = [];
    let malformedBlocks = 0;

    for (const [index, block] of blocks.entries()) {
      let value: unknown;
      try {
        value = JSON.parse(block);
      } catch (error) {
        malformedBlocks += 1;
        errors.push({
          message: `JSON-LD block ${index + 1} is not valid JSON`,
          code: "MALFORMED_JSON_LD",
          context: { blockIndex: index, reason: (error as Error).message },
        });
        continue;
      }
      collectJobPostings(value, jobPostingNodes);
    }

    if (jobPostingNodes.length === 0) {
      errors.push({
        message: "No JobPosting entries found in the page's JSON-LD",
        code: "NO_JOBPOSTING_FOUND",
        context: { blockCount: blocks.length, malformedBlocks },
      });
      return {
        parsedJobs,
        errors,
        metadata: { sourceType: payload.sourceType, blockCount: blocks.length },
      };
    }

    for (const [index, node] of jobPostingNodes.entries()) {
      const title = typeof node["title"] === "string" ? (node["title"] as string).trim() : "";
      const company = extractCompany(node);

      if (!title || !company) {
        errors.push({
          message: `JobPosting ${index + 1} is missing a required "title" or "hiringOrganization"`,
          code: "INCOMPLETE_JOBPOSTING",
          context: { index, hasTitle: Boolean(title), hasCompany: Boolean(company) },
        });
        continue;
      }

      const job: ParsedJob = { title, company };

      const location = extractLocation(node);
      if (location) job.location = location;

      const description = typeof node["description"] === "string" ? stripHtml(node["description"]) : undefined;
      if (description) job.description = description;

      const url = extractUrl(node);
      if (url) job.url = url;

      const postedAt = extractPostedAt(node);
      if (postedAt) job.postedAt = postedAt;

      parsedJobs.push(job);
    }

    return {
      parsedJobs,
      errors,
      metadata: {
        sourceType: payload.sourceType,
        blockCount: blocks.length,
        jobPostingCount: jobPostingNodes.length,
      },
    };
  },
});
