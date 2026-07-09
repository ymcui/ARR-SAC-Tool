# Changelog

All notable user-facing changes are documented here.

## [2.6.0] - 2026-07-09

### Added

- Added reviewer score overlays to the overall assessment distribution chart for excitement, soundness, and reviewer confidence.
- Added an individual overall-score distribution chart for raw reviewer overall assessment scores.
- Added meta-review confidence parsing and charting alongside meta-review score distributions.
- Added a Ready `x/y` summary pill to the Alerts tab.
- Added overall score context beside each paper number in the Comments tab.

### Changed

- Reorganized Analytics into a two-row chart layout with consistent legends, colors, tooltip labels, and empty states.
- Kept meta-review confidence hidden when no meta-review confidence scores are available.
- Refined Paper Stats chart height so the paper type and completed-review panels align better.

## [2.5.2] - 2026-07-09

### Fixed

- Bypassed the local Next.js API proxy for browser sessions on `localhost` or `127.0.0.1` so long dashboard loads are less likely to be dropped by the web proxy.
- Passed the runtime API origin from the Next.js server page to the dashboard client so production starts with custom API ports use the correct backend.
- Derived FastAPI CORS origins from the configured local web port so custom local ports continue to support direct API calls.
- Kept raw browser connection errors in the progress card while showing actionable recovery guidance in the dashboard alert.

## [2.5.1] - 2026-07-08

### Fixed

- Recovered initial dashboard loads when a long OpenReview request finishes on the API but the local web proxy drops the browser request.
- Replaced raw browser connection errors with actionable dashboard guidance to refresh the page, sign in again if needed, and retry Load / Refresh.

## [2.5.0] - 2026-07-08

### Added

- Added sortable column headers to the AC Dashboard table, matching the Papers and Alerts table interaction pattern.
- Sorted AC Dashboard count-pair columns by completed count first, then total count, so values such as `2 / 3` and `3 / 4` order consistently.

## [2.4.2] - 2026-07-08

### Changed

- Coalesced overlapping dashboard loads for the same SAC and venue so repeated refreshes reuse the in-flight API work instead of starting duplicate OpenReview scans.
- Parallelized area chair contact lookups and reused bulk commitment-stage group data for faster dashboard assembly.
- Memoized derived dashboard data across Papers, AC Dashboard, Alerts, Comments, and Analytics to reduce repeated browser-side table and chart work.

### Fixed

- Preserved commitment-stage group fallback behavior when an expected primary assignment group exists but is empty.

## [2.4.1] - 2026-07-07

### Fixed

- Fixed Reviews column sorting in the Papers and Alerts tables so it sorts by finished review count first, then total assigned reviews.

## [2.4.0] - 2026-07-07

### Added

- Added sortable column headers to the Alerts table, matching the Papers table interaction pattern.
- Defaulted the Alerts table to sort by Ready status so papers not ready for rebuttal appear first.

## [2.3.3] - 2026-07-07

### Fixed

- Recovered dashboard refreshes when a long-running refresh finishes on the API but the local web proxy drops the browser request.
- Guarded refresh recovery against stale progress from previous loads so the app does not silently reuse old cached data.
- Changed failed load progress labels from Done to Failed.

## [2.3.2] - 2026-07-05

### Added

- Added Program Chair official comments to the Comments tab as a distinct Program Chairs type.
- Added a Program Chairs comment badge and filter support.

### Fixed

- Fixed the no-content illustration background so it blends cleanly into empty states.
- Widened empty-state helper text to avoid awkward wrapping on spacious layouts.

## [2.3.1] - 2026-07-04

### Changed

- Refined empty states across Comments, Alerts, Analytics, and lazy-loaded Analytics with softer layout and clearer wording.
- Added a polished no-content illustration for empty states.
- Rendered the no-content illustration as a real SVG image without blur filters so it stays crisp when scaled in the app.

## [2.3.0] - 2026-07-04

### Added

- Added a Paper Stats panel before the existing Analytics section.
- Added a paper type mix donut chart with Long, Short, and Other counts plus percentages.
- Added a completed-reviews distribution chart to show how many papers have each review count.
- Added percentage labels to review-count tooltips and the zero-review warning badge.

### Changed

- Refined the Paper Stats chart layout with a larger donut, side legend on wide screens, and responsive stacking on narrower screens.

## [2.2.1] - 2026-07-04

### Added

- Added compact venue summary cards for paper count and AC count after a dashboard is loaded.
- Added a Ready column to the Alerts table.

### Changed

- Combined the venue Load and Refresh controls into one Load / Refresh action.
- Changed unavailable score wording from Pending to N/A and showed individual overall scores in the Alerts table.
- Pointed the update-available badge directly to the changelog.
- Refined footer placement and venue summary styling.

## [2.2.0] - 2026-07-03

### Added

- Added an ARR-only Alerts tab for review-chasing emergencies, including reviewer delay notifications and emergency declarations.
- Added an Alerts table with paper number, area chair, paper type, review completion, emergency count, delay count, and overall score.
- Added expandable alert rows with structured alert text, official follow-up comments, and OpenReview links.
- Added alert totals in the Alerts header and dashboard API summary.
- Added a small footer with the GitHub repository link and local app version.
- Added the latest version number to the update-available badge.

### Changed

- Kept alert threads separate from the normal Comments tab so delay and emergency notices do not create duplicate or orphaned comment entries.
- Kept standalone official SAC comments out of the normal Comments tab.
- Bumped the dashboard cache version for the new API response shape.

## [2.1.4] - 2026-06-10

### Fixed

- Fixed ARR scoping for public-readable submissions whose OpenReview readers include `everyone`.
- Added per-submission SAC group metadata to keep assigned ARR papers in scope even when readers alone are not sufficient.
- Added regression tests for public-readable ARR submission scope handling.

## [2.1.3] - 2026-05-16

### Added

- Added an update-available indicator that checks the latest GitHub `package.json` version.
- Added frontend version helpers for local version display and GitHub repository links.

## [2.1.2] - 2026-05-15

### Added

- Added a production `npm run start` flow for running the API and web app together.
- Added configurable web/API hosts and ports for local, remote, and notebook-style deployments.
- Added support for using a system Python interpreter instead of the local virtual environment.
- Added Colab-oriented setup documentation.

### Changed

- Routed frontend API calls through the web app proxy instead of directly targeting the backend port from the browser.
- Expanded README setup, venue, usage, privacy, and feedback documentation.

## [2.1.1] - 2026-05-13

### Added

- Added area chair display names and email addresses to the dashboard data.
- Added AC Dashboard controls to copy all area chair emails or a single area chair email.
- Added a missing meta-review summary badge to the AC Dashboard.
- Added comment type badges and per-paper comment type breakdowns.

### Changed

- Simplified the Comments tab filters to search and type.
- Improved Comments and AC Dashboard header layouts.
- Showed missing meta-reviews with the same boolean-icon treatment used elsewhere in tables.

## [2.1.0] - 2026-05-08

### Added

- Added commitment-stage support alongside ARR-stage dashboard use.
- Added commitment-stage XLSX export support for offline SAC ranking.
- Added recent venue reuse and clearer stage-specific README guidance.
- Added the project license.

### Changed

- Compacted commitment-stage XLSX column sizing for easier offline review.
- Removed the bundled notebook from the main branch and ignored notebook files going forward.
