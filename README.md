# ARR SAC Tool

A local dashboard for ACL Rolling Review and ACL commitment-stage Senior Area Chairs.

SAC Monitor helps you load your assigned OpenReview venue, inspect paper status, read comments, review score distributions, and export commitment-stage papers to Excel for offline ranking. It runs on your own machine and uses your OpenReview login only for the current local session.

> [!NOTE]
> If you prefer the jupyter notebook version, please check `old` branch, which is the version I used in ARR Feb 2025 cycle.

## Latest Supported Venues

ARR Stage:
- aclweb.org/ACL/ARR/2026/March
- aclweb.org/ACL/ARR/2026/January

Commitment Stage:
- aclweb.org/ACL/2026/Conference

## Requirements

Before running the dashboard, make sure you have:

- An OpenReview account with SAC access to the venue you want to inspect
- Node.js with `npm`
- Python 3.9 or newer

If you do not already have Node.js and `npm`, install Node.js from [nodejs.org](https://nodejs.org/). The `npm` command is included with the standard Node.js installer.

## Installation

Just run:
```bash
npm install
```

You only need to run `npm install` once after downloading the repository, or again later if the project dependencies change.

## Start The Dashboard

1. Run `npm run dev`
2. Open [http://127.0.0.1:8000](http://127.0.0.1:8000)
3. Sign in with your OpenReview email and password
4. Enter a venue ID and click **Load venue**

ARR example:

`aclweb.org/ACL/ARR/2026/March`

Commitment-stage example:

`aclweb.org/ACL/2026/Conference`

The first `npm run dev` creates a local Python environment in `.venv` and installs the backend requirements automatically. Later launches should be faster.

## What You Can Monitor

- ARR review-stage venues, shown as **ARR Stage**
- Commitment-stage conference venues, shown as **Commitment Stage**
- Per-paper status, scores, comments, and analytics
- ARR-stage AC rollups
- Commitment-stage ranking fields, including XLSX export for offline SAC ranking

The venue textbox remembers recently loaded valid venue IDs, so you do not need to retype common venues each time.

## Usage for ARR Stage

As indicated above, Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser first, then sign in with your OpenReview email and password. Enter your venue ID and click **Load venue**. The dashboard will load the venue data and display it in the corresponding section.

<p align="center">
    <br>
    <img src="./assets/1-login.png" width="400"/>
    <br>
</p>

<p align="center">
    <br>
    <img src="./assets/2-venue.png" width="600"/>
    <br>
</p>

### Page: Papers

The `Paper` page will show all papers in the ARR review stage. Clicking on a paper will show its details.

The top part also shows how many papers are ready for rebuttal (i.e., at least three reviews have been submitted) and how many missing reviews.

<p align="center">
    <br>
    <img src="./assets/3-paper-view.png" width="800"/>
    <br>
</p>

### Page: AC Dashboard

In `AC Dashboard`, you can check each AC's assigned papers and their review status, which is useful to check review/meta-review progress.

<p align="center">
    <br>
    <img src="./assets/4-ac-dashboard.png" width="800"/>
    <br>
</p>

### Page: Comments

In `Comments`, you can check critical comments that need to draw SAC attention, such as author-editor confidential comments, review issue reports, etc.

Clicking a comment will show its content, and you can also click the "View on OpenReview" link to open the comment in the original OpenReview page to get better context.

<p align="center">
    <br>
    <img src="./assets/5-comments.png" width="800"/>
    <br>
</p>

### Page: Analytics

In `Analytics`, you can view various metrics and visualizations related to the papers and reviews in the ARR stage.

<p align="center">
    <br>
    <img src="./assets/6-analytics.png" width="800"/>
    <br>
</p>

## Usage for Commitment Stage

Similar to the ARR stage, you can load a commitment-stage venue and check the papers assigned to you. The `Commitment Stage` section will show the papers in the commitment stage.

The main goal of commitment stage for SACs is to rank the papers and give a recommendation on whether to accept or reject. You can click the "Export to Excel" button to export the papers assigned to you into an Excel file, which contains most of the information you need for ranking, such as paper scores, meta-reviews, etc.

<p align="center">
    <br>
    <img src="./assets/7-commitment.png" width="800"/>
    <br>
</p>

> [!CAUTION]
>  Please do not solely rely on the exported Excel file for ranking, as it may not contain all the information you need (like detailed reviews, etc.). Always check the original OpenReview page for each paper to get the full context before making your final decision.


## Privacy

- Your OpenReview credentials are sent only to the local backend running on your machine.
- Credentials are not written to disk by this app.
- Loaded dashboard data is cached in memory for faster refreshes during the current local run.


## Feedback

As ARR and *ACL conferences are making updates to processes and tools, the provided tools may not fully adapt to any ARR cycle or commitment stage. If you encounter any issues or have suggestions for improvement, please feel free to open an issue in this repository.
