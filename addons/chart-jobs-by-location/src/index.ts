import { defineChartAddon, type ChartError, type ChartRequest, type ChartResult, type ParsedJob } from "@jobflo/addon-sdk";
import { arc as d3Arc, pie as d3Pie } from "d3-shape";

/**
 * Jobs by Location (Donut Chart) addon.
 *
 * The second chart/visualization addon built against `defineChartAddon`
 * (SDK 1.1.0), deliberately using a different rendering approach from the
 * companion `chart-jobs-by-company` bar chart addon: this one uses
 * `d3-shape`'s `pie()` and `arc()` generators (path-geometry computation)
 * rather than `d3-scale`'s band/linear scales (axis-position computation)
 * — a different specialized library for a different geometric problem,
 * both operating headlessly with no DOM.
 *
 * As with the bar chart addon, DOM-measuring libraries (Recharts,
 * Victory's `ResponsiveContainer`-style layout) and canvas-based ones
 * (Chart.js via `chartjs-node-canvas`, which needs a native `canvas`
 * build) were evaluated and ruled out for the same reason: they either
 * render an empty wrapper with no `renderToStaticMarkup`-visible DOM to
 * measure, or drag in a fragile native dependency. `d3-shape` computes
 * arc paths purely from numbers in, SVG path string out.
 */

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 400;
const MAX_SLICES = 8;
const OTHER_LABEL = "Other";

const PALETTE = [
  "#6366f1", // indigo
  "#22c55e", // green
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#ef4444", // red
  "#84cc16", // lime
  "#94a3b8", // slate (reserved for "Other")
];

interface LocationCount {
  location: string;
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

function countByLocation(jobs: ParsedJob[]): LocationCount[] {
  const counts = new Map<string, number>();

  for (const job of jobs) {
    const location = typeof job.location === "string" && job.location.trim() ? job.location.trim() : "Unknown";
    counts.set(location, (counts.get(location) ?? 0) + 1);
  }

  return Array.from(counts, ([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count);
}

/** Caps to the top N locations by count, folding the remainder into "Other". */
function capToTop(counts: LocationCount[], limit: number): LocationCount[] {
  if (counts.length <= limit) return counts;

  const top = counts.slice(0, limit);
  const rest = counts.slice(limit);
  const otherTotal = rest.reduce((sum, entry) => sum + entry.count, 0);

  if (otherTotal > 0) {
    top.push({ location: OTHER_LABEL, count: otherTotal });
  }

  return top;
}

function renderDonutChartSvg(counts: LocationCount[], width: number, height: number, theme: "light" | "dark"): string {
  const palette =
    theme === "dark"
      ? { background: "#0f172a", text: "#e2e8f0", subtext: "#94a3b8", stroke: "#0f172a" }
      : { background: "#ffffff", text: "#0f172a", subtext: "#475569", stroke: "#ffffff" };

  const total = counts.reduce((sum, c) => sum + c.count, 0);

  const legendWidth = Math.min(240, width * 0.4);
  const chartAreaWidth = width - legendWidth;
  const chartAreaHeight = height;
  const centerX = chartAreaWidth / 2;
  const centerY = chartAreaHeight / 2;
  const outerRadius = Math.max(10, Math.min(chartAreaWidth, chartAreaHeight) / 2 - 16);
  const innerRadius = outerRadius * 0.6;

  const pieLayout = d3Pie<LocationCount>()
    .value((d) => d.count)
    .sort(null);
  const arcGen = d3Arc<ReturnType<typeof pieLayout>[number]>().innerRadius(innerRadius).outerRadius(outerRadius);

  const arcs = pieLayout(counts);

  const slices = arcs
    .map((a, i) => {
      const d = arcGen(a) ?? "";
      const color = a.data.location === OTHER_LABEL ? PALETTE[PALETTE.length - 1] : PALETTE[i % (PALETTE.length - 1)];
      return `<path d="${d}" fill="${color}" stroke="${palette.stroke}" stroke-width="2"></path>`;
    })
    .join("\n    ");

  const legendItemHeight = Math.min(28, (height - 32) / Math.max(1, counts.length));
  const legend = counts
    .map((c, i) => {
      const color = c.location === OTHER_LABEL ? PALETTE[PALETTE.length - 1] : PALETTE[i % (PALETTE.length - 1)];
      const y = 16 + i * legendItemHeight;
      const pct = total > 0 ? Math.round((c.count / total) * 100) : 0;
      const label = escapeXml(truncateLabel(c.location, 22));

      return `
    <g transform="translate(0, ${y.toFixed(1)})">
      <rect x="0" y="-9" width="12" height="12" rx="2" fill="${color}"></rect>
      <text x="18" y="1" font-size="12" fill="${palette.text}">${label}</text>
      <text x="18" y="15" font-size="11" fill="${palette.subtext}">${c.count} (${pct}%)</text>
    </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, sans-serif">
  <rect x="0" y="0" width="${width}" height="${height}" fill="${palette.background}"></rect>
  <g transform="translate(${centerX.toFixed(1)}, ${centerY.toFixed(1)})">
    ${slices}
    <text x="0" y="0" text-anchor="middle" dominant-baseline="middle" font-size="20" font-weight="600" fill="${palette.text}">${total}</text>
    <text x="0" y="18" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="${palette.subtext}">jobs</text>
  </g>
  <g transform="translate(${(chartAreaWidth + 16).toFixed(1)}, ${(centerY - (legendItemHeight * counts.length) / 2).toFixed(1)})">${legend}
  </g>
</svg>`;
}

export default defineChartAddon({
  manifest: {
    id: "chart-jobs-by-location",
    name: "Jobs by Location (Donut Chart)",
    version: "1.0.0",
    description: "Renders a donut chart of job counts per location from a set of parsed jobs, for the analytics section.",
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
        title: "Jobs by Location",
        errors,
        metadata: { locationCount: 0, totalJobs: 0 },
      };
    }

    const allCounts = countByLocation(request.jobs);
    const shown = capToTop(allCounts, MAX_SLICES);

    return {
      format: "svg",
      content: renderDonutChartSvg(shown, width, height, theme),
      title: "Jobs by Location",
      errors,
      metadata: {
        locationCount: allCounts.length,
        totalJobs: request.jobs.length,
        slicesShown: shown.length,
      },
    };
  },
});
