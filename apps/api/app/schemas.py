from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class ViewerInfo(BaseModel):
    id: str
    fullname: str


class LoginRequest(BaseModel):
    username: str
    password: str


class VenueInfo(BaseModel):
    venueId: str
    stage: str
    submissionName: str
    lastSyncedAt: str


class SummaryInfo(BaseModel):
    totalPapers: int
    readyPapers: int
    metaReviewsDone: int
    commentsCount: int
    alertsCount: int = 0


class ScoreSummary(BaseModel):
    average: Optional[float] = None
    values: List[float] = Field(default_factory=list)


class PaperRecord(BaseModel):
    paperNumber: int
    paperId: str
    paperTitle: str = ""
    paperType: str = ""
    areaChair: str
    completedReviews: int
    expectedReviews: int
    readyForRebuttal: bool
    authorResponseReady: bool
    acChecklistReady: bool
    resubmission: bool = False
    preprint: bool = False
    hasConfidential: bool = False
    issueReport: bool = False
    reviewerConfidence: ScoreSummary = Field(default_factory=ScoreSummary)
    soundnessScore: ScoreSummary = Field(default_factory=ScoreSummary)
    excitementScore: ScoreSummary = Field(default_factory=ScoreSummary)
    overallAssessment: ScoreSummary = Field(default_factory=ScoreSummary)
    metaReviewScore: Optional[float] = None
    metaReviewText: str = ""
    responseToMetaReview: str = ""
    forumUrl: str


class WithdrawnPaperRecord(BaseModel):
    paperNumber: int
    paperId: str
    paperTitle: str = ""
    paperType: str = ""
    areaChair: str = ""
    status: str
    forumUrl: str


class AreaChairRecord(BaseModel):
    areaChair: str
    areaChairName: str = ""
    areaChairEmail: str = ""
    totalCompletedReviews: int
    totalExpectedReviews: int
    papersReady: int
    numPapers: int
    allReviewsReady: bool
    metaReviewsDone: int
    acChecklistDone: int
    allMetaReviewsReady: bool


class CommentRecord(BaseModel):
    noteId: str
    paperNumber: int
    paperId: str
    type: str
    role: str
    date: str
    content: str
    link: str
    children: List["CommentRecord"] = Field(default_factory=list)


class CommentGroup(BaseModel):
    paperNumber: int
    paperId: str
    paperTitle: str = ""
    forumUrl: str
    items: List[CommentRecord] = Field(default_factory=list)


class AlertRecord(BaseModel):
    noteId: str
    paperNumber: int
    paperId: str
    type: str
    role: str
    signerLabel: str = ""
    date: str
    content: str
    link: str
    children: List["AlertRecord"] = Field(default_factory=list)


class AlertGroup(BaseModel):
    paperNumber: int
    paperId: str
    paperTitle: str = ""
    forumUrl: str
    items: List[AlertRecord] = Field(default_factory=list)


class HistogramPoint(BaseModel):
    label: str
    center: float
    count: int


class DistributionPoint(BaseModel):
    score: float
    count: int


class ScatterPoint(BaseModel):
    paperNumber: int
    paperLabel: str
    areaChair: str
    overallAssessment: float
    metaReviewScore: float


class AnalyticsInfo(BaseModel):
    overallAssessmentHistogram: List[HistogramPoint] = Field(default_factory=list)
    metaReviewDistribution: List[DistributionPoint] = Field(default_factory=list)
    pairedScatter: List[ScatterPoint] = Field(default_factory=list)


class DashboardLoadProgress(BaseModel):
    venueId: str
    loadId: Optional[str] = None
    phase: str = "idle"
    message: str = ""
    current: int = 0
    total: int = 0
    done: bool = False
    error: Optional[str] = None


class DashboardResponse(BaseModel):
    viewer: ViewerInfo
    venue: VenueInfo
    summary: SummaryInfo
    papers: List[PaperRecord] = Field(default_factory=list)
    areaChairs: List[AreaChairRecord] = Field(default_factory=list)
    withdrawnPapers: List[WithdrawnPaperRecord] = Field(default_factory=list)
    comments: List[CommentGroup] = Field(default_factory=list)
    alerts: List[AlertGroup] = Field(default_factory=list)
    analytics: AnalyticsInfo = Field(default_factory=AnalyticsInfo)


if hasattr(CommentRecord, "model_rebuild"):
    CommentRecord.model_rebuild()
    AlertRecord.model_rebuild()
else:
    CommentRecord.update_forward_refs()
    AlertRecord.update_forward_refs()
