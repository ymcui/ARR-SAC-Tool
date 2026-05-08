from __future__ import annotations

import re
import zipfile
from io import BytesIO
from typing import Any, Iterable, List, Sequence
from xml.sax.saxutils import escape

from app.schemas import DashboardResponse, PaperRecord

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_EXCEL_CELL_CHARS = 32767


def build_dashboard_export_xlsx(dashboard: DashboardResponse) -> bytes:
    is_commitment_stage = dashboard.venue.stage == "Commitment Stage"
    rows = _export_rows(dashboard)
    return _build_xlsx(rows, "Papers", is_commitment_stage=is_commitment_stage)


def export_filename(venue_id: str) -> str:
    safe_venue = re.sub(r"[^A-Za-z0-9._-]+", "_", venue_id).strip("_") or "venue"
    return f"{safe_venue}_paper_export.xlsx"


def _export_rows(dashboard: DashboardResponse) -> List[List[Any]]:
    papers = sorted(dashboard.papers, key=lambda paper: paper.paperNumber)
    if dashboard.venue.stage == "Commitment Stage":
        return [_commitment_headers()] + [_commitment_row(paper) for paper in papers]
    return [_arr_headers()] + [_arr_row(paper) for paper in papers]


def _commitment_headers() -> List[str]:
    return [
        "Submission Number",
        "Paper Link",
        "Paper Type",
        "Reviewer Confidence Avg",
        "Reviewer Confidence Details",
        "Soundness Score Avg",
        "Soundness Score Details",
        "Excitement Score Avg",
        "Excitement Score Details",
        "Overall Assessment Avg",
        "Overall Assessment Details",
        "Meta Review Score",
        "Meta Review",
        "Response to Meta Review",
        "Resubmission",
        "Preprint",
        "Has Confidential",
        "Issue Report",
        "SAC Ranking",
        "Score",
        "Confidence",
        "Recommendation",
        "Presentation",
        "Best Paper Recommendation",
        "SAC Meta Review",
    ]


def _commitment_row(paper: PaperRecord) -> List[Any]:
    return [
        paper.paperNumber,
        paper.forumUrl,
        paper.paperType,
        _score(paper.reviewerConfidence.average),
        _score_details(paper.reviewerConfidence.values),
        _score(paper.soundnessScore.average),
        _score_details(paper.soundnessScore.values),
        _score(paper.excitementScore.average),
        _score_details(paper.excitementScore.values),
        _score(paper.overallAssessment.average),
        _score_details(paper.overallAssessment.values),
        _score(paper.metaReviewScore),
        paper.metaReviewText,
        paper.responseToMetaReview,
        _checkmark(paper.resubmission),
        _checkmark(paper.preprint),
        _checkmark(paper.hasConfidential),
        _checkmark(paper.issueReport),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
    ]


def _arr_headers() -> List[str]:
    return [
        "Paper",
        "Paper ID",
        "Title",
        "Area Chair",
        "Type",
        "Completed Reviews",
        "Expected Reviews",
        "Ready",
        "Responses",
        "Checklist",
        "Meta",
        "Overall",
        "Soundness",
        "Excitement",
        "Confidence",
        "OpenReview",
    ]


def _arr_row(paper: PaperRecord) -> List[Any]:
    return [
        paper.paperNumber,
        paper.paperId,
        paper.paperTitle,
        paper.areaChair,
        paper.paperType,
        paper.completedReviews,
        paper.expectedReviews,
        _yes_no(paper.readyForRebuttal),
        _yes_no(paper.authorResponseReady),
        _yes_no(paper.acChecklistReady),
        _score(paper.metaReviewScore),
        _score(paper.overallAssessment.average),
        _score(paper.soundnessScore.average),
        _score(paper.excitementScore.average),
        _score(paper.reviewerConfidence.average),
        paper.forumUrl,
    ]


def _score(value: float | None) -> float | str:
    return "" if value is None else round(float(value), 2)


def _yes_no(value: bool) -> str:
    return "Yes" if value else "No"


def _checkmark(value: bool) -> str:
    return "√" if value else ""


def _score_details(values: Iterable[float]) -> str:
    return " / ".join(f"{value:.1f}" for value in values)


def _build_xlsx(rows: Sequence[Sequence[Any]], sheet_name: str, is_commitment_stage: bool = False) -> bytes:
    links = _worksheet_links(rows) if is_commitment_stage else []
    output = BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", _content_types_xml())
        workbook.writestr("_rels/.rels", _root_rels_xml())
        workbook.writestr("xl/workbook.xml", _workbook_xml(sheet_name))
        workbook.writestr("xl/_rels/workbook.xml.rels", _workbook_rels_xml())
        workbook.writestr("xl/styles.xml", _styles_xml())
        workbook.writestr(
            "xl/worksheets/sheet1.xml",
            _worksheet_xml(rows, is_commitment_stage=is_commitment_stage, links=links),
        )
        if links:
            workbook.writestr("xl/worksheets/_rels/sheet1.xml.rels", _worksheet_rels_xml(links))
    return output.getvalue()


def _worksheet_xml(
    rows: Sequence[Sequence[Any]],
    is_commitment_stage: bool = False,
    links: Sequence[tuple[int, str]] | None = None,
) -> str:
    links = links or []
    column_count = max((len(row) for row in rows), default=1)
    last_column = _column_name(column_count)
    last_row = max(len(rows), 1)
    dimension_ref = f"A1:{last_column}{last_row}"
    row_xml = []
    for row_index, row in enumerate(rows, start=1):
        cells = [
            _cell_xml(
                row_index,
                column_index,
                value,
                header=row_index == 1,
                is_commitment_stage=is_commitment_stage,
            )
            for column_index, value in enumerate(row, start=1)
        ]
        row_attrs = f'r="{row_index}" spans="1:{column_count}"'
        if is_commitment_stage:
            height = "90" if row_index == 1 else "180"
            row_attrs += f' ht="{height}" customHeight="1"'
        row_xml.append(f"<row {row_attrs}>{''.join(cells)}</row>")

    filter_ref = f"A1:{last_column}1"
    cols_xml = _cols_xml(is_commitment_stage)
    hyperlinks_xml = _hyperlinks_xml(links)

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="{dimension_ref}"/>'
        '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
        '<sheetFormatPr defaultRowHeight="15"/>'
        f"{cols_xml}"
        f"<sheetData>{''.join(row_xml)}</sheetData>"
        f'<autoFilter ref="{filter_ref}"/>'
        f"{hyperlinks_xml}"
        "</worksheet>"
    )


def _cols_xml(is_commitment_stage: bool) -> str:
    if not is_commitment_stage:
        return ""
    compact_width = 8.0
    long_text_width = 75.0
    widths = [
        (compact_width, False),
        (compact_width, False),
        (compact_width, False),
        (compact_width, False),
        (compact_width, True),
        (compact_width, False),
        (compact_width, True),
        (compact_width, False),
        (compact_width, True),
        (compact_width, False),
        (compact_width, True),
        (compact_width, False),
        (long_text_width, False),
        (long_text_width, False),
        (compact_width, False),
        (compact_width, False),
        (compact_width, False),
        (compact_width, False),
        (compact_width, False),
        (compact_width, False),
        (compact_width, False),
        (17.5, False),
        (compact_width, False),
        (compact_width, False),
        (long_text_width, False),
    ]
    cols = []
    for index, (width, hidden) in enumerate(widths, start=1):
        hidden_attr = ' hidden="1"' if hidden else ""
        cols.append(
            f'<col min="{index}" max="{index}" width="{width}" customWidth="1"{hidden_attr}/>'
        )
    return f"<cols>{''.join(cols)}</cols>"


def _cell_xml(
    row_index: int,
    column_index: int,
    value: Any,
    header: bool = False,
    is_commitment_stage: bool = False,
) -> str:
    ref = f"{_column_name(column_index)}{row_index}"
    style_id = _cell_style_id(row_index, column_index, header, is_commitment_stage)
    style = f' s="{style_id}"' if style_id else ""
    if is_commitment_stage and row_index > 1 and column_index == 2 and _is_url(value):
        value = "link"
    if value in (None, ""):
        return f'<c r="{ref}"{style}/>'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"{style}><v>{value}</v></c>'

    text = _escape_text(value)
    return f'<c r="{ref}" t="inlineStr"{style}><is><t xml:space="preserve">{text}</t></is></c>'


def _cell_style_id(row_index: int, column_index: int, header: bool, is_commitment_stage: bool) -> int:
    if not is_commitment_stage:
        return 1 if header else 0
    if header and column_index >= 19:
        return 2
    if header:
        return 1
    if column_index in {13, 14, 25}:
        return 4
    return 3


def _column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _worksheet_links(rows: Sequence[Sequence[Any]]) -> List[tuple[int, str]]:
    links: List[tuple[int, str]] = []
    for row_index, row in enumerate(rows[1:], start=2):
        if len(row) < 2:
            continue
        value = str(row[1] or "").strip()
        if _is_url(value):
            links.append((row_index, value))
    return links


def _hyperlinks_xml(links: Sequence[tuple[int, str]]) -> str:
    if not links:
        return ""
    hyperlinks = [
        f'<hyperlink ref="B{row_index}" r:id="rId{index}"/>'
        for index, (row_index, _target) in enumerate(links, start=1)
    ]
    return f"<hyperlinks>{''.join(hyperlinks)}</hyperlinks>"


def _worksheet_rels_xml(links: Sequence[tuple[int, str]]) -> str:
    relationships = [
        (
            f'<Relationship Id="rId{index}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
            f'Target="{_escape_attr(target)}" TargetMode="External"/>'
        )
        for index, (_row_index, target) in enumerate(links, start=1)
    ]
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{''.join(relationships)}"
        "</Relationships>"
    )


def _is_url(value: Any) -> bool:
    return str(value or "").strip().startswith(("http://", "https://"))


def _escape_attr(value: Any) -> str:
    return escape(_clean_xml_text(str(value)), {'"': "&quot;"})


def _escape_text(value: Any) -> str:
    return escape(_clean_xml_text(str(value or "")))


def _clean_xml_text(value: str) -> str:
    if len(value) > MAX_EXCEL_CELL_CHARS:
        value = value[: MAX_EXCEL_CELL_CHARS - 12] + " [truncated]"

    return "".join(character for character in value if _is_valid_xml_character(character))


def _is_valid_xml_character(character: str) -> bool:
    codepoint = ord(character)
    return (
        codepoint in {0x09, 0x0A, 0x0D}
        or 0x20 <= codepoint <= 0xD7FF
        or 0xE000 <= codepoint <= 0xFFFD
        or 0x10000 <= codepoint <= 0x10FFFF
    )


def _content_types_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        "</Types>"
    )


def _root_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )


def _workbook_xml(sheet_name: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{escape(sheet_name)}" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )


def _workbook_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
        "</Relationships>"
    )


def _styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font>'
        '<font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor indexed="64"/></patternFill></fill></fills>'
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
        '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">'
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="1" fillId="1" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">'
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">'
        '<alignment vertical="center" wrapText="1"/></xf></cellXfs>'
        "</styleSheet>"
    )
