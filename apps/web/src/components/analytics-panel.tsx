"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { EmptyStateIcon } from "@/components/empty-state-icon";
import type { AnalyticsInfo, PaperRecord } from "@/lib/types";

type AnalyticsPanelProps = {
  analytics: AnalyticsInfo;
  papers: PaperRecord[];
};

const META_REVIEW_SCORE_TICKS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const PAPER_TYPE_COLORS = ["#315fd6", "#35b8b2", "#a6542f"];
const REVIEW_BAR_COLOR = "#315fd6";
const NO_REVIEW_BAR_COLOR = "#d94f70";

type PaperTypePoint = {
  name: string;
  value: number;
  percentage: number;
};

type ReviewCountPoint = {
  reviewCount: number;
  label: string;
  paperCount: number;
  tooltipLabel: string;
};

function formatPaperShare(count: number, total: number) {
  const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
  const noun = count === 1 ? "paper" : "papers";

  return `${count} ${noun} (${percentage}%)`;
}

function paperTypeLabel(paperType: string) {
  const normalizedType = paperType.toLowerCase();

  if (normalizedType.includes("short")) {
    return "Short";
  }
  if (normalizedType.includes("long")) {
    return "Long";
  }

  return "Other";
}

function buildPaperTypeData(papers: PaperRecord[]): PaperTypePoint[] {
  const counts = new Map<string, number>([
    ["Long", 0],
    ["Short", 0],
    ["Other", 0]
  ]);

  for (const paper of papers) {
    const label = paperTypeLabel(paper.paperType || "");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const totalPapers = papers.length || 1;
  return [...counts.entries()]
    .map(([name, value]) => ({
      name,
      value,
      percentage: Math.round((value / totalPapers) * 100)
    }))
    .filter((point) => point.value > 0);
}

function buildReviewCountData(papers: PaperRecord[]): ReviewCountPoint[] {
  if (papers.length === 0) {
    return [];
  }

  const maxReviews = Math.max(...papers.map((paper) => paper.completedReviews));
  const counts = new Map<number, number>();

  for (let reviewCount = 0; reviewCount <= maxReviews; reviewCount += 1) {
    counts.set(reviewCount, 0);
  }

  for (const paper of papers) {
    counts.set(paper.completedReviews, (counts.get(paper.completedReviews) ?? 0) + 1);
  }

  return [...counts.entries()].map(([reviewCount, paperCount]) => {
    return {
      reviewCount,
      label: String(reviewCount),
      paperCount,
      tooltipLabel: formatPaperShare(paperCount, papers.length)
    };
  });
}

export default function AnalyticsPanel({ analytics, papers }: AnalyticsPanelProps) {
  const paperTypeData = buildPaperTypeData(papers);
  const reviewCountData = buildReviewCountData(papers);
  const zeroReviewLabel =
    reviewCountData.find((point) => point.reviewCount === 0)?.tooltipLabel ?? formatPaperShare(0, papers.length);

  return (
    <>
      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Paper mix</p>
            <h2>Paper Stats</h2>
          </div>
        </div>

        <div className="chart-grid">
          <div className="chart-surface">
            <h3>Paper type mix</h3>
            {paperTypeData.length === 0 ? (
              <div className="empty-state inset">
                <EmptyStateIcon />
                <h3>No paper records yet.</h3>
                <p>Paper type percentages will appear after a venue loads active papers.</p>
              </div>
            ) : (
              <div className="paper-type-chart-body">
                <div className="chart-frame">
                  <ResponsiveContainer height="100%" minWidth={0} width="100%">
                    <PieChart>
                      <Pie
                        cx="50%"
                        cy="50%"
                        data={paperTypeData}
                        dataKey="value"
                        innerRadius="55%"
                        nameKey="name"
                        outerRadius="90%"
                        paddingAngle={2}
                      >
                        {paperTypeData.map((point, index) => (
                          <Cell fill={PAPER_TYPE_COLORS[index % PAPER_TYPE_COLORS.length]} key={point.name} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name) => [`${value} papers`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="paper-stats-legend" aria-label="Paper type breakdown">
                  {paperTypeData.map((point, index) => (
                    <div className="paper-stats-legend-item" key={point.name}>
                      <span
                        aria-hidden="true"
                        className="paper-stats-swatch"
                        style={{ background: PAPER_TYPE_COLORS[index % PAPER_TYPE_COLORS.length] }}
                      />
                      <span>{point.name}</span>
                      <strong>
                        {point.value} ({point.percentage}%)
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="chart-surface">
            <div className="chart-title-row">
              <h3>Completed reviews per paper</h3>
              <span className="status-chip withdrawn">0 reviews: {zeroReviewLabel}</span>
            </div>
            {reviewCountData.length === 0 ? (
              <div className="empty-state inset">
                <EmptyStateIcon />
                <h3>No review records yet.</h3>
                <p>Review coverage will appear after papers and reviews are loaded.</p>
              </div>
            ) : (
              <div className="chart-frame">
                <ResponsiveContainer height="100%" minWidth={0} width="100%">
                  <BarChart data={reviewCountData}>
                    <CartesianGrid stroke="rgba(31, 54, 62, 0.12)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" name="Completed reviews" tickLine={false} />
                    <YAxis allowDecimals={false} name="Papers" tickLine={false} />
                    <Tooltip
                      formatter={(_value, _name, item) => [
                        (item.payload as ReviewCountPoint | undefined)?.tooltipLabel ?? formatPaperShare(0, papers.length),
                        "Papers"
                      ]}
                      labelFormatter={(value) => `${value} completed reviews`}
                    />
                    <Bar dataKey="paperCount" name="Papers" radius={[8, 8, 0, 0]}>
                      {reviewCountData.map((point) => (
                        <Cell
                          fill={point.reviewCount === 0 ? NO_REVIEW_BAR_COLOR : REVIEW_BAR_COLOR}
                          key={point.reviewCount}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Secondary analysis</p>
            <h2>Analytics</h2>
          </div>
        </div>

        <div className="chart-grid">
          <div className="chart-surface">
            <h3>Overall assessment distribution</h3>
            <div className="chart-frame">
              <ResponsiveContainer height="100%" minWidth={0} width="100%">
                <LineChart data={analytics.overallAssessmentHistogram}>
                  <CartesianGrid stroke="rgba(31, 54, 62, 0.12)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} />
                  <Tooltip />
                  <Line dataKey="count" name="Papers" stroke="#127a6b" strokeWidth={2.5} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-surface">
            <h3>Meta-review score distribution</h3>
            <div className="chart-frame">
              <ResponsiveContainer height="100%" minWidth={0} width="100%">
                <LineChart data={analytics.metaReviewDistribution}>
                  <CartesianGrid stroke="rgba(31, 54, 62, 0.12)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="score"
                    domain={[1, 5]}
                    tickFormatter={(value) => Number(value).toFixed(1)}
                    tickLine={false}
                    ticks={META_REVIEW_SCORE_TICKS}
                    type="number"
                  />
                  <YAxis allowDecimals={false} tickLine={false} />
                  <Tooltip />
                  <Line dataKey="count" name="Meta-reviews" stroke="#a6542f" strokeWidth={2.5} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="chart-surface tall">
          <h3>Meta-review score vs overall assessment</h3>
          {analytics.pairedScatter.length === 0 ? (
            <div className="empty-state inset">
              <EmptyStateIcon />
              <h3>Not enough paired data yet.</h3>
              <p>Paired scores will appear after papers have both reviewer averages and meta-review scores.</p>
            </div>
          ) : (
            <div className="chart-frame tall">
              <ResponsiveContainer height="100%" minWidth={0} width="100%">
                <ScatterChart>
                  <CartesianGrid stroke="rgba(31, 54, 62, 0.12)" />
                  <XAxis dataKey="overallAssessment" name="Overall assessment" tickLine={false} type="number" />
                  <YAxis dataKey="metaReviewScore" name="Meta-review" tickLine={false} type="number" />
                  <Tooltip cursor={{ strokeDasharray: "4 4" }} />
                  <Legend />
                  <Scatter data={analytics.pairedScatter} fill="#127a6b" name="Papers" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
