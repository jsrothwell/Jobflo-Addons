import { defineAddon, type ParsedJob, type ParserError } from "@jobflo/addon-sdk";

/**
 * Starter addon: parses newline-delimited "Title @ Company" lines into jobs.
 * Copy this folder as a starting point for a real addon and replace the
 * `parse` logic with your own source-specific extraction.
 */
export default defineAddon({
  manifest: {
    id: "starter-template",
    name: "Starter Template",
    version: "1.0.0",
    description: "Reference implementation demonstrating the defineAddon contract.",
    author: "jsrothwell",
    permissions: ["filesystem:read"],
    targetEvents: ["data:ingest"],
  },

  parse(payload) {
    const parsedJobs: ParsedJob[] = [];
    const errors: ParserError[] = [];

    const lines = payload.rawContent.split("\n").map((line) => line.trim()).filter(Boolean);

    for (const [index, line] of lines.entries()) {
      const [title, company] = line.split("@").map((part) => part?.trim());

      if (!title || !company) {
        errors.push({
          message: `Line ${index + 1} is not in "Title @ Company" format`,
          code: "MALFORMED_LINE",
          context: { line },
        });
        continue;
      }

      parsedJobs.push({ title, company });
    }

    return {
      parsedJobs,
      errors,
      metadata: {
        sourceType: payload.sourceType,
        lineCount: lines.length,
      },
    };
  },
});
