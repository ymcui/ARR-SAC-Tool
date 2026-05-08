"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import type { AnalyticsInfo } from "@/lib/types";

type AnalyticsPanelProps = {
  analytics: AnalyticsInfo;
};

const META_REVIEW_SCORE_TICKS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export default function AnalyticsPanel({ analytics }: AnalyticsPanelProps) {
  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Secondary analysis</p>
          <h2>Analytics</h2>
        </div>
        <p className="section-note">
          Optional score distributions and paired assessment scatter stay separate from the working
          surface so the main review flow remains fast.
        </p>
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
            <h3>Not enough paired data yet.</h3>
            <p>The scatter plot appears once papers have both reviewer averages and meta-reviews.</p>
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
  );
}
