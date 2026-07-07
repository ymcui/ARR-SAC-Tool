export type ViewerInfo = {
  id: string;
  fullname: string;
};

export type VenueStage = "ARR Stage" | "Commitment Stage";

export type VenueInfo = {
  venueId: string;
  stage: VenueStage;
  submissionName: string;
  lastSyncedAt: string;
};

export type SummaryInfo = {
  totalPapers: number;
  readyPapers: number;
  metaReviewsDone: number;
  commentsCount: number;
  alertsCount: number;
};

export type ScoreSummary = {
  average: number | null;
  values: number[];
};

export type PaperRecord = {
  paperNumber: number;
  paperId: string;
  paperTitle: string;
  paperType: string;
  areaChair: string;
  completedReviews: number;
  expectedReviews: number;
  readyForRebuttal: boolean;
  authorResponseReady: boolean;
  acChecklistReady: boolean;
  resubmission: boolean;
  preprint: boolean;
  hasConfidential: boolean;
  issueReport: boolean;
  reviewerConfidence: ScoreSummary;
  soundnessScore: ScoreSummary;
  excitementScore: ScoreSummary;
  overallAssessment: ScoreSummary;
  metaReviewScore: number | null;
  metaReviewText: string;
  responseToMetaReview: string;
  forumUrl: string;
};

export type WithdrawnPaperRecord = {
  paperNumber: number;
  paperId: string;
  paperTitle: string;
  paperType: string;
  areaChair: string;
  status: string;
  forumUrl: string;
};

export type AreaChairRecord = {
  areaChair: string;
  areaChairName: string;
  areaChairEmail: string;
  totalCompletedReviews: number;
  totalExpectedReviews: number;
  papersReady: number;
  numPapers: number;
  allReviewsReady: boolean;
  metaReviewsDone: number;
  acChecklistDone: number;
  allMetaReviewsReady: boolean;
};

export type CommentRecord = {
  noteId: string;
  paperNumber: number;
  paperId: string;
  type: string;
  role: string;
  date: string;
  content: string;
  link: string;
  children: CommentRecord[];
};

export type CommentGroup = {
  paperNumber: number;
  paperId: string;
  paperTitle: string;
  forumUrl: string;
  items: CommentRecord[];
};

export type AlertRecord = {
  noteId: string;
  paperNumber: number;
  paperId: string;
  type: string;
  role: string;
  signerLabel?: string;
  date: string;
  content: string;
  link: string;
  children: AlertRecord[];
};

export type AlertGroup = {
  paperNumber: number;
  paperId: string;
  paperTitle: string;
  forumUrl: string;
  items: AlertRecord[];
};

export type HistogramPoint = {
  label: string;
  center: number;
  count: number;
};

export type DistributionPoint = {
  score: number;
  count: number;
};

export type ScatterPoint = {
  paperNumber: number;
  paperLabel: string;
  areaChair: string;
  overallAssessment: number;
  metaReviewScore: number;
};

export type AnalyticsInfo = {
  overallAssessmentHistogram: HistogramPoint[];
  metaReviewDistribution: DistributionPoint[];
  pairedScatter: ScatterPoint[];
};

export type DashboardLoadProgress = {
  venueId: string;
  loadId?: string | null;
  phase: string;
  message: string;
  current: number;
  total: number;
  done: boolean;
  error: string | null;
};

export type DashboardResponse = {
  viewer: ViewerInfo;
  venue: VenueInfo;
  summary: SummaryInfo;
  papers: PaperRecord[];
  areaChairs: AreaChairRecord[];
  withdrawnPapers: WithdrawnPaperRecord[];
  comments: CommentGroup[];
  alerts: AlertGroup[];
  analytics: AnalyticsInfo;
};

export type TabKey = "papers" | "ac" | "alerts" | "comments" | "analytics";
