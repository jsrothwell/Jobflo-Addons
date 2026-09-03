import { defineAddon, type ParsedJob, type ParserError } from "@jobflo/addon-sdk";

/**
 * ATS JSON API addon (Greenhouse & Lever).
 *
 * Unlike the LinkedIn and Indeed addons, this one doesn't read pasted
 * detail-panel text — it reads the raw JSON that Greenhouse's and Lever's
 * own public job board APIs return, e.g. from:
 *
 *   https://boards-api.greenhouse.io/v1/boards/<company>/jobs?content=true
 *   https://api.lever.co/v0/postings/<company>
 *
 * Both are real, unauthenticated, well-known endpoints many company career
 * pages call directly from the browser. Fetch one (curl, a browser tab, the
 * host app) and paste the response body in. Verified against two live
 * boards (Sept 2026): Greenhouse's boards-api (`{ "jobs": [...] }`) and
 * Lever's postings API (a bare `[...]` array) — the two shapes are
 * distinguished automatically, so this one addon covers both ATSes.
 *
 * A structural difference worth knowing: Lever's posting objects don't
 * include a company name field at all (the board is single-tenant, so the
 * company is implied by which URL you fetched, not encoded in the JSON).
 * When `payload.metadata.company` isn't supplied by the caller, this addon
 * derives a best-effort company name from the posting's own hostedUrl slug
 * (e.g. "https://jobs.lever.co/acme-co/..." -> "Acme Co") rather than
 * failing the whole batch over a field the source data simply doesn't have.
 *
 * This is also the first addon in this registry that produces more than
 * one job per parse: a single response can list dozens of postings, and an
 * individual entry missing a title (or, for Lever, an unresolvable company)
 * is skipped with a non-fatal ParserError rather than aborting the batch.
 */

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&[a-zA-Z#0-9]+;/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

function stripHtmlTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Greenhouse's `content` field HTML-escapes its own markup (e.g. the tag
 * "<h2>" is delivered as the literal text "&lt;h2&gt;"), so entities must
 * be decoded first to reveal the real tags before those tags can be
 * stripped — the reverse order from ordinary HTML.
 */
function plainTextFromGreenhouseContent(raw: string): string {
  return stripHtmlTags(decodeHtmlEntities(raw));
}

/** Lever's list content is ordinary HTML (real tags, literal entities). */
function plainTextFromLeverHtml(raw: string): string {
  return decodeHtmlEntities(stripHtmlTags(raw));
}

/** Best-effort company name from a jobs.lever.co/<slug>/... URL. Not authoritative. */
function companyFromLeverUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = /jobs\.lever\.co\/([^/]+)/i.exec(url);
  const slug = match?.[1];
  if (!slug) return undefined;
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type BoardFormat = "greenhouse" | "lever";

function detectFormat(parsed: unknown): BoardFormat | undefined {
  if (Array.isArray(parsed)) return "lever";
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)["jobs"])) {
    return "greenhouse";
  }
  return undefined;
}

function mapGreenhouseJob(entry: Record<string, unknown>): ParsedJob | undefined {
  const title = typeof entry["title"] === "string" ? (entry["title"] as string).trim() : undefined;
  const company = typeof entry["company_name"] === "string" ? (entry["company_name"] as string).trim() : undefined;
  if (!title || !company) return undefined;

  const job: ParsedJob = { title, company, source: "greenhouse" };

  const location = entry["location"];
  if (location && typeof location === "object") {
    const name = (location as Record<string, unknown>)["name"];
    if (typeof name === "string" && name.trim()) job.location = name.trim();
  }

  const postedAt = entry["first_published"] ?? entry["updated_at"];
  if (typeof postedAt === "string" && postedAt.trim()) job.postedAt = postedAt.trim();

  const content = entry["content"];
  if (typeof content === "string" && content.trim()) {
    job.description = plainTextFromGreenhouseContent(content);
  }

  const url = entry["absolute_url"];
  if (typeof url === "string" && url.trim()) job.url = url.trim();

  const departments = entry["departments"];
  if (Array.isArray(departments) && departments[0] && typeof departments[0] === "object") {
    const name = (departments[0] as Record<string, unknown>)["name"];
    if (typeof name === "string" && name.trim()) job.department = name.trim();
  }

  const offices = entry["offices"];
  if (Array.isArray(offices) && offices[0] && typeof offices[0] === "object") {
    const name = (offices[0] as Record<string, unknown>)["name"];
    if (typeof name === "string" && name.trim()) job.office = name.trim();
  }

  return job;
}

function mapLeverJob(entry: Record<string, unknown>, metadataCompany: string | undefined): ParsedJob | undefined {
  const title = typeof entry["text"] === "string" ? (entry["text"] as string).trim() : undefined;
  const hostedUrl = typeof entry["hostedUrl"] === "string" ? (entry["hostedUrl"] as string) : undefined;
  const company = metadataCompany ?? companyFromLeverUrl(hostedUrl) ?? companyFromLeverUrl(entry["applyUrl"] as string | undefined);
  if (!title || !company) return undefined;

  const job: ParsedJob = { title, company, source: "lever" };
  if (hostedUrl) job.url = hostedUrl;

  const categories = entry["categories"];
  if (categories && typeof categories === "object") {
    const c = categories as Record<string, unknown>;
    if (typeof c["location"] === "string" && (c["location"] as string).trim()) job.location = (c["location"] as string).trim();
    if (typeof c["team"] === "string" && (c["team"] as string).trim()) job.department = (c["team"] as string).trim();
    if (typeof c["commitment"] === "string" && (c["commitment"] as string).trim()) job.employmentType = (c["commitment"] as string).trim();
  }

  if (typeof entry["workplaceType"] === "string" && (entry["workplaceType"] as string).trim()) {
    job.workplaceType = (entry["workplaceType"] as string).trim();
  }

  const createdAt = entry["createdAt"];
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
    job.postedAt = new Date(createdAt).toISOString();
  }

  const descriptionParts: string[] = [];
  for (const key of ["openingPlain", "descriptionPlain", "descriptionBodyPlain"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) descriptionParts.push(value.trim());
  }
  const lists = entry["lists"];
  if (Array.isArray(lists)) {
    for (const item of lists) {
      if (!item || typeof item !== "object") continue;
      const heading = (item as Record<string, unknown>)["text"];
      const content = (item as Record<string, unknown>)["content"];
      const body = typeof content === "string" ? plainTextFromLeverHtml(content) : "";
      if (typeof heading === "string" && heading.trim() && body) {
        descriptionParts.push(`${heading.trim()}\n${body}`);
      } else if (body) {
        descriptionParts.push(body);
      }
    }
  }
  const additionalPlain = entry["additionalPlain"];
  if (typeof additionalPlain === "string" && additionalPlain.trim()) descriptionParts.push(additionalPlain.trim());

  if (descriptionParts.length > 0) job.description = descriptionParts.join("\n\n");

  return job;
}

export default defineAddon({
  manifest: {
    id: "ats-json-api",
    name: "ATS JSON API (Greenhouse & Lever)",
    version: "1.0.0",
    description:
      "Parses the raw JSON response from Greenhouse's or Lever's public job board API (detected automatically) into normalized jobs, all in one pass.",
    author: "jsrothwell",
    permissions: ["clipboard:read"],
    targetEvents: ["data:ingest"],
  },

  parse(payload) {
    const parsedJobs: ParsedJob[] = [];
    const errors: ParserError[] = [];

    const raw = payload.rawContent.trim();
    if (!raw) {
      errors.push({ message: "Input is empty", code: "NO_CONTENT" });
      return { parsedJobs, errors, metadata: { sourceType: payload.sourceType } };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push({
        message:
          "Input is not valid JSON. Paste the raw response body from a boards-api.greenhouse.io/v1/boards/<company>/jobs or api.lever.co/v0/postings/<company> request.",
        code: "INVALID_JSON",
      });
      return { parsedJobs, errors, metadata: { sourceType: payload.sourceType } };
    }

    const format = detectFormat(parsed);
    if (!format) {
      errors.push({
        message:
          'Could not recognize this as a Greenhouse ("{ jobs: [...] }") or Lever ("[...]") job board API response.',
        code: "UNRECOGNIZED_SHAPE",
      });
      return { parsedJobs, errors, metadata: { sourceType: payload.sourceType } };
    }

    const metadataCompany =
      typeof payload.metadata?.["company"] === "string" ? (payload.metadata["company"] as string) : undefined;

    const entries: unknown[] = format === "greenhouse" ? (parsed as { jobs: unknown[] }).jobs : (parsed as unknown[]);

    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        errors.push({ message: `Entry at index ${index} is not an object`, code: "INVALID_ENTRY", context: { index } });
        return;
      }

      const job =
        format === "greenhouse"
          ? mapGreenhouseJob(entry as Record<string, unknown>)
          : mapLeverJob(entry as Record<string, unknown>, metadataCompany);

      if (!job) {
        errors.push({
          message: `Entry at index ${index} is missing a title${format === "lever" ? " or a resolvable company" : " or company_name"} and was skipped`,
          code: "INCOMPLETE_JOB_ENTRY",
          context: { index },
        });
        return;
      }

      parsedJobs.push(job);
    });

    return {
      parsedJobs,
      errors,
      metadata: {
        sourceType: payload.sourceType,
        format,
        totalEntries: entries.length,
        parsedCount: parsedJobs.length,
      },
    };
  },
});
