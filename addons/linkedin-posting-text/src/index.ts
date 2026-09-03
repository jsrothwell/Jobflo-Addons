import { defineAddon, type ParsedJob, type ParserError } from "@jobflo/addon-sdk";

/**
 * LinkedIn posting-text addon.
 *
 * LinkedIn doesn't expose structured job data to a logged-out request, so
 * unlike the schema-org-jobposting addon this one works from the plain text
 * a person gets selecting a job's detail panel and copying it. That text has
 * no format guarantee — it's whatever LinkedIn's UI happens to render — so
 * this parser is deliberately conservative: it anchors on the one heading
 * that's present on essentially every posting ("About the job") and on a
 * small set of literal UI strings, and it fails clearly (via ParserError)
 * rather than guessing when the shape doesn't match, instead of silently
 * producing wrong fields.
 *
 * Verified against a live posting's detail-panel text (Sept 2026). Expected
 * paste, in order:
 *
 *   Company
 *   Title
 *   Location · [Reposted] N <unit> ago · N applicants  (or "Over N people clicked apply")
 *   [Promoted by hirer · Responses managed off LinkedIn]   (sponsored postings only)
 *   Remote | On-site | Hybrid
 *   Full-time | Part-time | Contract | ...
 *   Apply
 *   Save
 *   About the job
 *   <description>
 *   Benefits found in job post                              (LinkedIn's own cutoff)
 *   ...
 */

const DESCRIPTION_START_RE = /^about the (job|role)$/i;

const DESCRIPTION_STOP_LINES = [
  "benefits found in job post",
  "about the company",
  "see how you compare to others who clicked apply",
  "show premium insights",
  "exclusive job seeker insights",
  "candidate seniority level",
  "candidates who clicked apply",
  "how your profile and resume are aligned with this job",
  "people also viewed",
  "meet the hiring team",
  "set alert for similar jobs",
];

const HEADER_NOISE_LINES = new Set([
  "apply",
  "save",
  "saved",
  "easy apply",
  "follow",
  "following",
  "use ai to assess how you fit",
]);

const HEADER_NOISE_RE = /promoted by hirer|responses managed off linkedin/i;

const WORKPLACE_TYPES = ["On-site", "Remote", "Hybrid"];
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Temporary", "Internship", "Volunteer", "Other"];

const RELATIVE_AGO_RE = /^(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago$/i;
const APPLICANT_COUNT_RE = /^(?:over\s+)?([\d,]+)\+?\s*(?:people clicked apply|applicants?)$/i;
const EARLY_APPLICANT_RE = /^be an early applicant$/i;

const UNIT_MS: Record<string, number> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000, // approximate, same imprecision LinkedIn's own display has
  year: 365 * 24 * 60 * 60 * 1000,
};

/** Converts "Reposted 5 days ago" / "3 weeks ago" / "Today" / "Yesterday" / "Just now" into an ISO timestamp. */
function relativeAgoToIso(text: string, referenceIso: string): string | undefined {
  const cleaned = text.replace(/^(?:re)?posted\s+/i, "").trim();

  if (/^just now$/i.test(cleaned) || /^today$/i.test(cleaned)) {
    return referenceIso;
  }
  if (/^yesterday$/i.test(cleaned)) {
    return new Date(new Date(referenceIso).getTime() - UNIT_MS.day).toISOString();
  }

  const match = RELATIVE_AGO_RE.exec(cleaned);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = (match[2] as string).toLowerCase();
  const ms = UNIT_MS[unit];
  if (ms === undefined || Number.isNaN(amount)) return undefined;

  return new Date(new Date(referenceIso).getTime() - amount * ms).toISOString();
}

interface MetaInfo {
  location?: string;
  postedAt?: string;
  applicantCount?: number;
  applicantCountIsApprox?: boolean;
  earlyApplicant?: boolean;
}

/** Splits "Toronto, ON · Reposted 5 days ago · Over 100 people clicked apply" into its parts. */
function parseMetaLine(line: string, referenceIso: string): MetaInfo {
  const segments = line.split("·").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return {};

  const info: MetaInfo = { location: segments[0] };

  for (const segment of segments.slice(1)) {
    const applicantMatch = APPLICANT_COUNT_RE.exec(segment);
    if (applicantMatch) {
      const raw = applicantMatch[1];
      if (raw !== undefined) {
        info.applicantCount = Number(raw.replace(/,/g, ""));
        info.applicantCountIsApprox = /^over\s+/i.test(segment);
      }
      continue;
    }
    if (EARLY_APPLICANT_RE.test(segment)) {
      info.earlyApplicant = true;
      continue;
    }
    const postedAt = relativeAgoToIso(segment, referenceIso);
    if (postedAt) {
      info.postedAt = postedAt;
    }
  }

  return info;
}

export default defineAddon({
  manifest: {
    id: "linkedin-posting-text",
    name: "LinkedIn Posting Text",
    version: "1.0.0",
    description:
      "Parses the plain text of a LinkedIn job posting's detail panel (company, title, location, badges, and About the job) into a normalized job.",
    author: "jsrothwell",
    permissions: ["clipboard:read"],
    targetEvents: ["data:ingest"],
  },

  parse(payload) {
    const parsedJobs: ParsedJob[] = [];
    const errors: ParserError[] = [];

    const allLines = payload.rawContent.split(/\r?\n/).map((l) => l.trim());

    if (allLines.every((l) => l.length === 0)) {
      errors.push({ message: "Input is empty", code: "NO_CONTENT" });
      return { parsedJobs, errors, metadata: { sourceType: payload.sourceType } };
    }

    const descriptionStartIndex = allLines.findIndex((l) => DESCRIPTION_START_RE.test(l));

    if (descriptionStartIndex === -1) {
      errors.push({
        message:
          'Could not find the "About the job" heading. Paste the job\'s detail panel starting from the company name and including the About the job section.',
        code: "NO_DESCRIPTION_MARKER",
      });
      return { parsedJobs, errors, metadata: { sourceType: payload.sourceType } };
    }

    // --- Header region: everything before "About the job" ---
    const headerLines = allLines
      .slice(0, descriptionStartIndex)
      .filter((l) => l.length > 0 && !HEADER_NOISE_RE.test(l) && !HEADER_NOISE_LINES.has(l.toLowerCase()));

    let workplaceType: string | undefined;
    let employmentType: string | undefined;
    let meta: MetaInfo = {};
    const identityLines: string[] = [];

    for (const line of headerLines) {
      const workplaceMatch = WORKPLACE_TYPES.find((t) => t.toLowerCase() === line.toLowerCase());
      if (workplaceMatch) {
        workplaceType = workplaceMatch;
        continue;
      }
      const employmentMatch = EMPLOYMENT_TYPES.find((t) => t.toLowerCase() === line.toLowerCase());
      if (employmentMatch) {
        employmentType = employmentMatch;
        continue;
      }
      if (line.includes("·") && !meta.location) {
        meta = parseMetaLine(line, payload.timestamp);
        continue;
      }
      identityLines.push(line);
    }

    const company = identityLines[0];
    const title = identityLines[1];

    if (!title || !company) {
      errors.push({
        message:
          'Could not identify both a company and a job title above "About the job". Expected the first two lines of the pasted panel to be the company name and the job title.',
        code: "INCOMPLETE_HEADER",
        context: { identityLines },
      });
      return {
        parsedJobs,
        errors,
        metadata: { sourceType: payload.sourceType, descriptionMarkerFound: true },
      };
    }

    const job: ParsedJob = { title, company };

    if (meta.location) {
      job.location = workplaceType ? `${meta.location} (${workplaceType})` : meta.location;
    } else if (workplaceType) {
      job.location = workplaceType;
    }
    if (meta.postedAt) job.postedAt = meta.postedAt;

    // --- Body region: everything after "About the job", truncated at LinkedIn's own cutoffs ---
    const bodyAllLines = allLines.slice(descriptionStartIndex + 1);
    let stopIndex = bodyAllLines.findIndex((l) => DESCRIPTION_STOP_LINES.includes(l.toLowerCase()));
    if (stopIndex === -1) stopIndex = bodyAllLines.length;

    const description = bodyAllLines
      .slice(0, stopIndex)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (description) job.description = description;

    parsedJobs.push(job);

    return {
      parsedJobs,
      errors,
      metadata: {
        sourceType: payload.sourceType,
        workplaceType,
        employmentType,
        applicantCount: meta.applicantCount,
        applicantCountIsApprox: meta.applicantCountIsApprox,
        earlyApplicant: meta.earlyApplicant,
      },
    };
  },
});
