import { defineChartAddon, type ChartError, type ChartRequest, type ChartResult, type ParsedJob } from "@jobflo/addon-sdk";
import { max as d3Max } from "d3-array";
import { scaleBand, scaleLinear } from "d3-scale";

/**
 * Jobs by Company (Bar Chart) addon.
 *
 * The first chart/visualization addon built against `defineChartAddon`
 * (added in this registry's SDK 1.1.0). It groups `ParsedJob[]` by
 * `company`, counts jobs per company, and renders a horizontal bar chart
 * as a bare, self-contained SVG string.
 *
 * Rendering approach: this addon computes its own bar geometry with
 * `d3-scale` (band + linear scales) and `d3-array` (`max`), then builds
 * the SVG by hand — no browser DOM, no `<canvas>`, and no React-based
 * charting library. That's a deliberate choice, not just a style
 * preference: libraries like Recharts and Victory compute their chart
 * geometry by measuring a live DOM container (via `ResponsiveContainer`
 * or layout effects), so `renderToStaticMarkup` against them in a
 * headless Node addon produces an empty wrapper with no chart inside —
 * confirmed while building this addon. Canvas-based options
 * (Chart.js via `chartjs-node-canvas`) need a native `canvas` build,
 * which is a heavy, fragile dependency for a local-first addon. `d3-scale`
 * and `d3-array` have neither problem: they're pure computation, so this
 * addon works the same whether Jobflo runs it in a browser view, Node, or
 * anywhere else the SDK contract is hosted.
 */

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 400;
const MARGIN = { top: 24, right: 56, bottom: 16, left: 160 };
const MAX_BARS = 12;
const OTHER_LABEL = "Other";

interface CompanyCount {
  company: string;
  count: number;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(0, maxChars - 1))}…`;
}

function countByCompany(jobs: ParsedJob[]): CompanyCount[] {
  const counts = new Map<string, number>();

  for (const job of jobs) {
    const company = typeof job.company === "string" && job.company.trim() ? job.company.trim() : "Unknown";
    counts.set(company, (counts.get(company) ?? 0) + 1);
  }

  return Array.from(counts, ([company, count]) => ({ company, count })).sort((a, b) => b.count - a.count);
}

/** Caps to the top N companies by count, folding the remainder into "Other". */
function capToTop(counts: CompanyCount[], limit: number): CompanyCount[] {
  if (counts.length <= limit) return counts;

  const top = counts.slice(0, limit);
  const rest = counts.slice(limit);
  const otherTotal = rest.reduce((sum, entry) => sum + entry.count, 0);

  if (otherTotal > 0) {
    top.push({ company: OTHER_LABEL, count: otherTotal });
  }

  return top;
}

function renderBarChartSvg(counts: CompanyCount[], width: number, height: number, theme: "light" | "dark"): string {
  const innerWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom);

  const palette =
    theme === "dark"
      ? { background: "#0f172a", bar: "#818cf8", text: "#e2e8f0", subtext: "#94a3b8", axis: "#334155" }
      : { background: "#ffffff", bar: "#4f46e5", text: "#0f172a", subtext: "#475569", axis: "#e2e8f0" };

  const maxCount = d3Max(counts, (d) => d.count) ?? 0;

  const y = scaleBand<string>()
    .domain(counts.map((d) => d.company))
    .range([0, innerHeight])
    .padding(0.25);

  const x = scaleLinear()
    .domain([0, maxCount === 0 ? 1 : maxCount])
    .range([0, innerWidth]);

  const bars = counts
    .map((d) => {
      const barHeight = y.bandwidth();
      const barWidth = Math.max(1, x(d.count));
      const barY = y(d.company) ?? 0;
      const label = escapeXml(truncateLabel(d.company, 24));
      const labelY = barY + barHeight / 2;

      return `
    <g>
      <text x="-8" y="${labelY.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="${palette.text}">${label}</text>
      <rect x="0" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3" fill="${palette.bar}"></rect>
      <text x="${(barWidth + 6).toFixed(1)}" y="${labelY.toFixed(1)}" dominant-baseline="middle" font-size="12" fill="${palette.subtext}">${d.count}</text>
    </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, sans-serif">
  <rect x="0" y="0" width="${width}" height="${height}" fill="${palette.background}"></rect>
  <g transform="translate(${MARGIN.left}, ${MARGIN.top})">${bars}
  </g>
</svg>`;
}

export default defineChartAddon({
  manifest: {
    id: "chart-jobs-by-company",
    name: "Jobs by Company (Bar Chart)",
    version: "1.0.0",
    description:
      "Renders a horizontal bar chart of job counts per company from a set of parsed jobs, for the analytics section.",
    author: "jsrothwell",
    permissions: [],
    targetEvents: ["analytics:render"],
  },

  render(request: ChartRequest): ChartResult {
    const errors: ChartError[] = [];
    const width = request.options?.width ?? DEFAULT_WIDTH;
    const height = request.options?.height ?? DEFAULT_HEIGHT;
    const theme = request.options?.theme === "dark" ? "dark" : "light";

    if (!request.jobs || request.jobs.length === 0) {
      errors.push({ message: "No jobs to chart", code: "NO_DATA" });
      return {
        format: "svg",
        content: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`,
        title: "Jobs by Company",
        errors,
        metadata: { companyCount: 0, totalJobs: 0 },
      };
    }

    const allCounts = countByCompany(request.jobs);
    const shown = capToTop(allCounts, MAX_BARS);

    return {
      format: "svg",
      content: renderBarChartSvg(shown, width, height, theme),
      title: "Jobs by Company",
      errors,
      metadata: {
        companyCount: allCounts.length,
        totalJobs: request.jobs.length,
        barsShown: shown.length,
      },
    };
  },
});
