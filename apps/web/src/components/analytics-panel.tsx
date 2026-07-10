"use client";

import { useMemo } from "react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
const INDIVIDUAL_SCORE_TICKS = META_REVIEW_SCORE_TICKS;
const REVIEW_SCORE_EDGES = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5];
const PAPER_TYPE_COLORS = ["#315fd6", "#35b8b2", "#a6542f"];
const REVIEW_BAR_COLOR = "#315fd6";
const NO_REVIEW_BAR_COLOR = "#d94f70";
const SCORE_LINE_COLORS = {
  overallAssessment: "#d94f70",
  excitementScore: "#56a8f5",
  soundnessScore: "#d7a51f",
  reviewerConfidence: "#9aa8bd"
};

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

type ScoreDistributionPoint = {
  label: string;
  center: number;
  overallAssessment: number;
  excitementScore: number;
  soundnessScore: number;
  reviewerConfidence: number;
};

type MetaReviewDistributionPoint = {
  score: number;
  metaReviewScore: number;
  metaReviewConfidence: number;
};

type IndividualOverallScorePoint = {
  score: number;
  label: string;
  reviewCount: number;
};

type ScoreStatistic = {
  key: keyof typeof SCORE_LINE_COLORS;
  label: string;
  minimum: number | null;
  maximum: number | null;
  average: number | null;
  median: number | null;
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

function scoreHistogramLabel(index: number) {
  if (index === REVIEW_SCORE_EDGES.length - 2) {
    return REVIEW_SCORE_EDGES[index].toFixed(1);
  }
  return `${REVIEW_SCORE_EDGES[index].toFixed(1)}-${REVIEW_SCORE_EDGES[index + 1].toFixed(1)}`;
}

function scoreHistogramCenter(index: number) {
  if (index === REVIEW_SCORE_EDGES.length - 2) {
    return REVIEW_SCORE_EDGES[index];
  }
  return (REVIEW_SCORE_EDGES[index] + REVIEW_SCORE_EDGES[index + 1]) / 2;
}

function formatScoreHistogramTooltipLabel(value: unknown) {
  if (typeof value !== "string") {
    return String(value ?? "");
  }

  const scoreRangeMatch = value.match(/^(\d(?:\.\d)?)-(\d(?:\.\d)?)$/);
  if (!scoreRangeMatch) {
    return `Score: ${value}`;
  }

  const [, lowerBound, upperBound] = scoreRangeMatch;
  return `${lowerBound} <= score < ${upperBound}`;
}

function buildScoreHistogram(papers: PaperRecord[], scoreKey: keyof Pick<PaperRecord, "excitementScore" | "soundnessScore" | "reviewerConfidence">) {
  const counts = new Map<string, number>();
  for (let index = 0; index < REVIEW_SCORE_EDGES.length - 1; index += 1) {
    counts.set(scoreHistogramLabel(index), 0);
  }

  for (const paper of papers) {
    const average = paper[scoreKey].average;
    if (average == null) {
      continue;
    }

    for (let index = 0; index < REVIEW_SCORE_EDGES.length - 1; index += 1) {
      const lowerBound = REVIEW_SCORE_EDGES[index];
      const upperBound = REVIEW_SCORE_EDGES[index + 1];
      if (lowerBound <= average && (average < upperBound || index === REVIEW_SCORE_EDGES.length - 2)) {
        const label = scoreHistogramLabel(index);
        counts.set(label, (counts.get(label) ?? 0) + 1);
        break;
      }
    }
  }

  return counts;
}

function buildScoreDistributionData(
  overallAssessmentHistogram: AnalyticsInfo["overallAssessmentHistogram"],
  papers: PaperRecord[]
): ScoreDistributionPoint[] {
  const excitementCounts = buildScoreHistogram(papers, "excitementScore");
  const soundnessCounts = buildScoreHistogram(papers, "soundnessScore");
  const confidenceCounts = buildScoreHistogram(papers, "reviewerConfidence");
  const overallCounts = new Map(overallAssessmentHistogram.map((point) => [point.label, point]));

  return Array.from({ length: REVIEW_SCORE_EDGES.length - 1 }, (_, index) => {
    const label = scoreHistogramLabel(index);
    const overallPoint = overallCounts.get(label);

    return {
      label,
      center: overallPoint?.center ?? scoreHistogramCenter(index),
      overallAssessment: overallPoint?.count ?? 0,
      excitementScore: excitementCounts.get(label) ?? 0,
      soundnessScore: soundnessCounts.get(label) ?? 0,
      reviewerConfidence: confidenceCounts.get(label) ?? 0
    };
  });
}

function buildIndividualOverallScoreData(papers: PaperRecord[]): IndividualOverallScorePoint[] {
  const counts = new Map(INDIVIDUAL_SCORE_TICKS.map((score) => [score, 0]));

  for (const paper of papers) {
    for (const score of paper.overallAssessment.values) {
      if (!Number.isFinite(score) || score < 1 || score > 5) {
        continue;
      }

      const normalizedScore = Number(score.toFixed(1));
      counts.set(normalizedScore, (counts.get(normalizedScore) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([scoreA], [scoreB]) => scoreA - scoreB)
    .map(([score, reviewCount]) => ({
      score,
      label: score.toFixed(1),
      reviewCount
    }));
}

function summarizeScores(scores: Array<number | null>): Omit<ScoreStatistic, "key" | "label"> {
  const sortedScores = scores
    .filter((score): score is number => score != null && Number.isFinite(score))
    .sort((left, right) => left - right);

  if (sortedScores.length === 0) {
    return { minimum: null, maximum: null, average: null, median: null };
  }

  const middleIndex = Math.floor(sortedScores.length / 2);
  const median =
    sortedScores.length % 2 === 0
      ? (sortedScores[middleIndex - 1] + sortedScores[middleIndex]) / 2
      : sortedScores[middleIndex];

  return {
    minimum: sortedScores[0],
    maximum: sortedScores[sortedScores.length - 1],
    average: sortedScores.reduce((total, score) => total + score, 0) / sortedScores.length,
    median
  };
}

function buildScoreStatistics(papers: PaperRecord[]): ScoreStatistic[] {
  return [
    {
      key: "overallAssessment",
      label: "Overall",
      ...summarizeScores(papers.map((paper) => paper.overallAssessment.average))
    },
    {
      key: "excitementScore",
      label: "Excitement",
      ...summarizeScores(papers.map((paper) => paper.excitementScore.average))
    },
    {
      key: "soundnessScore",
      label: "Soundness",
      ...summarizeScores(papers.map((paper) => paper.soundnessScore.average))
    },
    {
      key: "reviewerConfidence",
      label: "Confidence",
      ...summarizeScores(papers.map((paper) => paper.reviewerConfidence.average))
    }
  ];
}

function formatStatistic(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}

function ScoreStatisticsTable({
  label,
  statistics
}: {
  label: string;
  statistics: ScoreStatistic[];
}) {
  return (
    <div className="score-statistics-table-wrap">
      <table aria-label={label} className="score-statistics-table">
        <thead>
          <tr>
            <th scope="col">Score</th>
            <th scope="col">Min</th>
            <th scope="col">Max</th>
            <th scope="col">Average</th>
            <th scope="col">Median</th>
          </tr>
        </thead>
        <tbody>
          {statistics.map((statistic) => (
            <tr key={statistic.key}>
              <th scope="row">
                <span className="score-statistics-label">
                  <span
                    aria-hidden="true"
                    className="paper-stats-swatch"
                    style={{ background: SCORE_LINE_COLORS[statistic.key] }}
                  />
                  {statistic.label}
                </span>
              </th>
              <td>{formatStatistic(statistic.minimum)}</td>
              <td>{formatStatistic(statistic.maximum)}</td>
              <td>{formatStatistic(statistic.average)}</td>
              <td>{formatStatistic(statistic.median)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function roundToNearestHalfStep(score: number) {
  return Math.max(1, Math.min(5, Math.round(score * 2) / 2));
}

function buildMetaReviewDistributionData(
  metaReviewDistribution: AnalyticsInfo["metaReviewDistribution"],
  papers: PaperRecord[]
): MetaReviewDistributionPoint[] {
  const metaReviewCounts = new Map(metaReviewDistribution.map((point) => [point.score, point.count]));
  const confidenceCounts = new Map(META_REVIEW_SCORE_TICKS.map((score) => [score, 0]));

  for (const paper of papers) {
    const average = paper.metaReviewConfidence?.average;
    if (average == null) {
      continue;
    }

    const score = roundToNearestHalfStep(average);
    confidenceCounts.set(score, (confidenceCounts.get(score) ?? 0) + 1);
  }

  return META_REVIEW_SCORE_TICKS.map((score) => ({
    score,
    metaReviewScore: metaReviewCounts.get(score) ?? 0,
    metaReviewConfidence: confidenceCounts.get(score) ?? 0
  }));
}

export default function AnalyticsPanel({ analytics, papers }: AnalyticsPanelProps) {
  const paperTypeData = useMemo(() => buildPaperTypeData(papers), [papers]);
  const reviewCountData = useMemo(() => buildReviewCountData(papers), [papers]);
  const scoreDistributionData = useMemo(
    () => buildScoreDistributionData(analytics.overallAssessmentHistogram, papers),
    [analytics.overallAssessmentHistogram, papers]
  );
  const individualOverallScoreData = useMemo(() => buildIndividualOverallScoreData(papers), [papers]);
  const scoreStatistics = useMemo(() => buildScoreStatistics(papers), [papers]);
  const hasIndividualOverallScores = individualOverallScoreData.some((point) => point.reviewCount > 0);
  const metaReviewDistributionData = useMemo(
    () => buildMetaReviewDistributionData(analytics.metaReviewDistribution, papers),
    [analytics.metaReviewDistribution, papers]
  );
  const hasMetaReviewScores = metaReviewDistributionData.some((point) => point.metaReviewScore > 0);
  const hasMetaReviewConfidence = metaReviewDistributionData.some((point) => point.metaReviewConfidence > 0);
  const zeroReviewLabel = useMemo(
    () => reviewCountData.find((point) => point.reviewCount === 0)?.tooltipLabel ?? formatPaperShare(0, papers.length),
    [papers.length, reviewCountData]
  );

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
          <div className="chart-surface score-statistics-surface">
            <h3>Score statistics</h3>
            <div className="score-statistics-grid">
              <ScoreStatisticsTable
                label="Overall and excitement score statistics"
                statistics={scoreStatistics.slice(0, 2)}
              />
              <ScoreStatisticsTable
                label="Soundness and confidence score statistics"
                statistics={scoreStatistics.slice(2)}
              />
            </div>
          </div>

          <div className="chart-surface">
            <h3>Overall and reviewer score distributions</h3>
            <div aria-label="Score series" className="paper-stats-legend score-series-legend">
              <div className="paper-stats-legend-item">
                <span
                  aria-hidden="true"
                  className="paper-stats-swatch"
                  style={{ background: SCORE_LINE_COLORS.overallAssessment }}
                />
                <span>Overall</span>
              </div>
              <div className="paper-stats-legend-item">
                <span
                  aria-hidden="true"
                  className="paper-stats-swatch"
                  style={{ background: SCORE_LINE_COLORS.excitementScore }}
                />
                <span>Excitement</span>
              </div>
              <div className="paper-stats-legend-item">
                <span
                  aria-hidden="true"
                  className="paper-stats-swatch"
                  style={{ background: SCORE_LINE_COLORS.soundnessScore }}
                />
                <span>Soundness</span>
              </div>
              <div className="paper-stats-legend-item">
                <span
                  aria-hidden="true"
                  className="paper-stats-swatch"
                  style={{ background: SCORE_LINE_COLORS.reviewerConfidence }}
                />
                <span>Confidence</span>
              </div>
            </div>
            <div className="chart-frame">
              <ResponsiveContainer height="100%" minWidth={0} width="100%">
                <LineChart data={scoreDistributionData}>
                  <CartesianGrid stroke="rgba(31, 54, 62, 0.12)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} />
                  <Tooltip labelFormatter={formatScoreHistogramTooltipLabel} />
                  <Line
                    dataKey="overallAssessment"
                    name="Overall"
                    stroke={SCORE_LINE_COLORS.overallAssessment}
                    strokeWidth={2.5}
                    type="monotone"
                  />
                  <Line
                    dataKey="excitementScore"
                    name="Excitement"
                    stroke={SCORE_LINE_COLORS.excitementScore}
                    strokeWidth={2.5}
                    type="monotone"
                  />
                  <Line
                    dataKey="soundnessScore"
                    name="Soundness"
                    stroke={SCORE_LINE_COLORS.soundnessScore}
                    strokeWidth={2.5}
                    type="monotone"
                  />
                  <Line
                    dataKey="reviewerConfidence"
                    name="Confidence"
                    stroke={SCORE_LINE_COLORS.reviewerConfidence}
                    strokeWidth={2.5}
                    type="monotone"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-surface">
            <h3>Individual overall scores</h3>
            <div aria-label="Individual overall score series" className="paper-stats-legend score-series-legend">
              <div className="paper-stats-legend-item">
                <span aria-hidden="true" className="paper-stats-swatch" style={{ background: REVIEW_BAR_COLOR }} />
                <span>Reviews</span>
              </div>
            </div>
            {hasIndividualOverallScores ? (
              <div className="chart-frame">
                <ResponsiveContainer height="100%" minWidth={0} width="100%">
                  <BarChart data={individualOverallScoreData}>
                    <CartesianGrid stroke="rgba(31, 54, 62, 0.12)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" name="Overall score" tickLine={false} />
                    <YAxis allowDecimals={false} name="Reviews" tickLine={false} />
                    <Tooltip
                      formatter={(value) => [Number(value), "Reviews"]}
                      labelFormatter={(value) => `Score: ${value}`}
                    />
                    <Bar
                      dataKey="reviewCount"
                      fill={REVIEW_BAR_COLOR}
                      name="Reviews"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty-state inset">
                <EmptyStateIcon />
                <h3>No individual overall scores yet.</h3>
                <p>Reviewer-level overall score counts will appear after completed reviews load.</p>
              </div>
            )}
          </div>

          <div className="chart-surface">
            <h3>Meta-review and confidence score distribution</h3>
            {hasMetaReviewScores ? (
              <>
                <div aria-label="Meta-review series" className="paper-stats-legend score-series-legend">
                  <div className="paper-stats-legend-item">
                    <span
                      aria-hidden="true"
                      className="paper-stats-swatch"
                      style={{ background: SCORE_LINE_COLORS.overallAssessment }}
                    />
                    <span>Meta-review</span>
                  </div>
                  {hasMetaReviewConfidence ? (
                    <div className="paper-stats-legend-item">
                      <span
                        aria-hidden="true"
                        className="paper-stats-swatch"
                        style={{ background: SCORE_LINE_COLORS.reviewerConfidence }}
                      />
                      <span>Confidence</span>
                    </div>
                  ) : null}
                </div>
                <div className="chart-frame">
                  <ResponsiveContainer height="100%" minWidth={0} width="100%">
                    <LineChart data={metaReviewDistributionData}>
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
                      <Line
                        dataKey="metaReviewScore"
                        name="Meta-review"
                        stroke={SCORE_LINE_COLORS.overallAssessment}
                        strokeWidth={2.5}
                        type="monotone"
                      />
                      {hasMetaReviewConfidence ? (
                        <Line
                          dataKey="metaReviewConfidence"
                          name="Confidence"
                          stroke={SCORE_LINE_COLORS.reviewerConfidence}
                          strokeWidth={2.5}
                          type="monotone"
                        />
                      ) : null}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <div className="empty-state inset">
                <EmptyStateIcon />
                <h3>No meta-review scores yet.</h3>
                <p>Appears after ACs submit meta-reviews.</p>
              </div>
            )}
          </div>

          <div className="chart-surface">
            <h3>Meta-review score vs overall assessment</h3>
            {analytics.pairedScatter.length === 0 ? (
              <div className="empty-state inset">
                <EmptyStateIcon />
                <h3>Not enough paired data yet.</h3>
                <p>Appears after both reviewer averages and meta-reviews exist.</p>
              </div>
            ) : (
              <>
                <div aria-label="Paired score series" className="paper-stats-legend score-series-legend">
                  <div className="paper-stats-legend-item">
                    <span
                      aria-hidden="true"
                      className="paper-stats-swatch"
                      style={{ background: SCORE_LINE_COLORS.overallAssessment }}
                    />
                    <span>Paired scores</span>
                  </div>
                </div>
                <div className="chart-frame">
                  <ResponsiveContainer height="100%" minWidth={0} width="100%">
                    <ScatterChart>
                      <CartesianGrid stroke="rgba(31, 54, 62, 0.12)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="overallAssessment"
                        domain={[1, 5]}
                        name="Overall assessment"
                        tickFormatter={(value) => Number(value).toFixed(1)}
                        tickLine={false}
                        ticks={META_REVIEW_SCORE_TICKS}
                        type="number"
                      />
                      <YAxis
                        dataKey="metaReviewScore"
                        domain={[1, 5]}
                        name="Meta-review"
                        tickFormatter={(value) => Number(value).toFixed(1)}
                        tickLine={false}
                        ticks={META_REVIEW_SCORE_TICKS}
                        type="number"
                      />
                      <Tooltip cursor={{ strokeDasharray: "4 4" }} />
                      <Scatter
                        data={analytics.pairedScatter}
                        fill={SCORE_LINE_COLORS.overallAssessment}
                        name="Paired scores"
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
