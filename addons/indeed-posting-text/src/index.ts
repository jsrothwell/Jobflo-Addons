import { defineAddon, type ParsedJob, type ParserError } from "@jobflo/addon-sdk";

/**
 * Indeed posting-text addon.
 *
 * Like the LinkedIn addon, this works from the plain text of a job's detail
 * panel as a person would select and copy it — Indeed doesn't expose
 * structured job data to a logged-out request either. The panel's shape
 * varies more than LinkedIn's: whether a company rating, a salary, and a
 * "Job details" block (Pay / Job type fields) appear at all depends on the
 * listing. This parser anchors on the one heading present on essentially
 * every posting ("Full job description") and fails clearly rather than
 * guessing when the header above it doesn't resolve to a title and company.
 *
 * Verified against two live postings' detail-panel text (Sept 2026): one
 * with a salary range shown as an inline "$X - $Y a year - Full-time" line,
 * one with the same range broken into a "Job details" block (Pay / Job
 * type labels each followed by their value on the next line), and one with
 * no salary at all but a company rating instead. Expected paste, in order:
 *
 *   [Job Post Details]                        (panel label, optional)
 *   Title
 *   [- job post]                              (suffix, optional, own line)
 *   Company
 *   [(part of Parent Co)]                     (optional)
 *   [N.N]
 *   [N.N out of 5 stars]                      (rating, optional)
 *   Location
 *   [$X - $Y a year - Full-time]              (inline salary + type)
 *     -- or --
 *   [Job details
 *    Pay
 *    $X - $Y a year
 *    Job type
 *    Full-time]                               (block form, optional)
 *   [Apply on company site | Easily apply | Save job | Share Job | ...]
 *   Full job description
 *   <description>
 *   [Report job | Explore other jobs]         (Indeed's own cutoffs)
 *   ...
 */

const DESCRIPTION_START_RE = /^full job description$/i;

const DESCRIPTION_STOP_LINES = ["report job", "explore other jobs", "return to search result"];

const HEADER_NOISE_RE =
  /^(job post details|job details|easily apply|save job|saved|share job|apply on .*|you must .*)$/i;

const JOB_POST_SUFFIX_LINE_RE = /^-\s*job post$/i;
const TITLE_SUFFIX_RE = /\s*-\s*job post\s*$/i;
const RATING_LINE_RE = /^\d(?:\.\d)?$/;
const RATING_STARS_RE = /^\d(?:\.\d)?\s+out of 5 stars$/i;
const PARENTHETICAL_ONLY_RE = /^\(.+\)$/;

const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Temporary", "Internship", "Per diem", "Seasonal"];

const PAY_LABEL_RE = /^pay$/i;
const JOB_TYPE_LABEL_RE = /^job type$/i;
const SALARY_TEXT_RE = /\$[\d,]+(?:\.\d+)?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d+)?\s*(?:an?\s+(?:hour|year|month|week|day))/i;

export default defineAddon({
  manifest: {
    id: "indeed-posting-text",
    name: "Indeed Posting Text",
    version: "1.0.0",
    description:
      "Parses the plain text of an Indeed job posting's detail panel (title, company, location, pay, and Full job description) into a normalized job.",
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
          'Could not find the "Full job description" heading. Paste the job\'s detail panel starting from the title and including the Full job description section.',
        code: "NO_DESCRIPTION_MARKER",
      });
      return { parsedJobs, errors, metadata: { sourceType: payload.sourceType } };
    }

    // --- Header region: everything before "Full job description" ---
    const headerLines = allLines
      .slice(0, descriptionStartIndex)
      .filter(
        (l) =>
          l.length > 0 &&
          !HEADER_NOISE_RE.test(l) &&
          !JOB_POST_SUFFIX_LINE_RE.test(l) &&
          !RATING_LINE_RE.test(l) &&
          !RATING_STARS_RE.test(l) &&
          !PARENTHETICAL_ONLY_RE.test(l)
      );

    let salaryText: string | undefined;
    let employmentType: string | undefined;
    const identityLines: string[] = [];

    for (let i = 0; i < headerLines.length; i++) {
      const line = headerLines[i] as string;

      if (PAY_LABEL_RE.test(line)) {
        const next = headerLines[i + 1];
        if (next) {
          salaryText = next;
          i++;
        }
        continue;
      }
      if (JOB_TYPE_LABEL_RE.test(line)) {
        const next = headerLines[i + 1];
        if (next) {
          employmentType = next;
          i++;
        }
        continue;
      }

      const salaryMatch = SALARY_TEXT_RE.exec(line);
      if (salaryMatch) {
        // Inline form: "$120,000 - $160,000 a year - Full-time"
        salaryText = salaryMatch[0];
        const rest = line
          .slice(salaryMatch.index + salaryMatch[0].length)
          .replace(/^\s*-\s*/, "")
          .trim();
        const trailingType = EMPLOYMENT_TYPES.find((t) => t.toLowerCase() === rest.toLowerCase());
        if (trailingType) employmentType = trailingType;
        continue;
      }

      const employmentMatch = EMPLOYMENT_TYPES.find((t) => t.toLowerCase() === line.toLowerCase());
      if (employmentMatch) {
        employmentType = employmentMatch;
        continue;
      }

      identityLines.push(line);
    }

    const rawTitle = identityLines[0];
    const title = rawTitle ? rawTitle.replace(TITLE_SUFFIX_RE, "").trim() : rawTitle;
    const company = identityLines[1];
    const location = identityLines[2];

    if (!title || !company) {
      errors.push({
        message:
          'Could not identify both a title and a company above "Full job description". Expected the first two non-badge lines of the pasted panel to be the job title and the company name.',
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
    if (location) job.location = location;

    // --- Body region: everything after "Full job description", truncated at Indeed's own cutoffs ---
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
        salaryText,
        employmentType,
      },
    };
  },
});
