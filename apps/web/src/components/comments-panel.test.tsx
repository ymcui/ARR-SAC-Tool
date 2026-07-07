import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommentsPanel } from "@/components/comments-panel";
import type { CommentGroup } from "@/lib/types";

const commentsFixture: CommentGroup[] = [
  {
    paperNumber: 42,
    paperId: "paper42",
    paperTitle: "A Careful Study of Reviewer Discussion Dynamics",
    forumUrl: "https://openreview.net/forum?id=paper42",
    items: [
      {
        noteId: "comment1",
        paperNumber: 42,
        paperId: "paper42",
        type: "Official Comment",
        role: "Reviewer",
        date: "2026-05-01",
        content: "Please clarify the evaluation setup.",
        link: "https://openreview.net/forum?id=paper42&noteId=comment1",
        children: [
          {
            noteId: "comment2",
            paperNumber: 42,
            paperId: "paper42",
            type: "Author Response",
            role: "Author",
            date: "2026-05-02",
            content: "We added the missing baseline detail.",
            link: "https://openreview.net/forum?id=paper42&noteId=comment2",
            children: []
          }
        ]
      }
    ]
  },
  {
    paperNumber: 88,
    paperId: "paper88",
    paperTitle: "Improving Meta-review Readiness Signals",
    forumUrl: "https://openreview.net/forum?id=paper88",
    items: [
      {
        noteId: "comment3",
        paperNumber: 88,
        paperId: "paper88",
        type: "Confidential Comment",
        role: "Area Chair",
        date: "2026-05-03",
        content: "Needs SAC attention.",
        link: "https://openreview.net/forum?id=paper88&noteId=comment3",
        children: []
      }
    ]
  }
];

describe("CommentsPanel", () => {
  it("renders an empty state when there are no comments", () => {
    render(createElement(CommentsPanel, { comments: [] }));
    expect(screen.getByText(/no comments need attention/i)).toBeInTheDocument();
  });

  it("collapses paper comment groups by default and shows post counts", async () => {
    render(createElement(CommentsPanel, { comments: commentsFixture }));
    const user = userEvent.setup();

    expect(
      screen.getByRole("button", { name: /paper 42 a careful study of reviewer discussion dynamics 2 posts/i })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Official Comment: 1")).toBeInTheDocument();
    expect(screen.getByText("Author Response: 1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /paper 88 improving meta-review readiness signals 1 post/i })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Confidential Comment: 1")).toBeInTheDocument();
    expect(screen.queryByText("paper42")).not.toBeInTheDocument();
    expect(screen.queryByText("Please clarify the evaluation setup.")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /paper 42 a careful study of reviewer discussion dynamics 2 posts/i })
    );

    expect(
      screen.getByRole("button", { name: /paper 42 a careful study of reviewer discussion dynamics 2 posts/i })
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Please clarify the evaluation setup.")).toBeInTheDocument();
    expect(screen.getByText("We added the missing baseline detail.")).toBeInTheDocument();
    expect(screen.getByText("Open forum")).toBeInTheDocument();
    expect(screen.queryByText("Needs SAC attention.")).not.toBeInTheDocument();
  });

  it("shows Program Chair comments as a filterable type", async () => {
    const user = userEvent.setup();
    render(
      createElement(CommentsPanel, {
        comments: [
          {
            paperNumber: 10145,
            paperId: "paper10145",
            paperTitle: "GPTZero Result Scope",
            forumUrl: "https://openreview.net/forum?id=paper10145",
            items: [
              {
                noteId: "pc-comment",
                paperNumber: 10145,
                paperId: "paper10145",
                type: "Program Chairs",
                role: "Program Chair",
                date: "2026-07-04",
                content: "GPTZero result requires SAC attention.",
                link: "https://openreview.net/forum?id=paper10145&noteId=pc-comment",
                children: []
              }
            ]
          }
        ]
      })
    );

    expect(screen.getByText("Program Chairs: 1")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Type"), "Program Chairs");
    await user.click(screen.getByRole("button", { name: /paper 10145 gptzero result scope 1 post/i }));

    expect(screen.getByText("GPTZero result requires SAC attention.")).toBeInTheDocument();
  });
});
