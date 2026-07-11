import { createElement } from "react";
import { render, screen } from "@testing-library/react";

import { LoadProgressPanel } from "@/components/load-progress-panel";
import type { DashboardLoadProgress } from "@/lib/types";

const baseProgress: DashboardLoadProgress = {
  venueId: "aclweb.org/ACL/ARR/2026/March",
  phase: "papers",
  message: "Scanning papers...",
  current: 25,
  total: 100,
  done: false,
  error: null
};

describe("LoadProgressPanel", () => {
  it("shows the current phase, count, message, and determinate width", () => {
    const { container } = render(createElement(LoadProgressPanel, { progress: baseProgress }));

    const status = screen.getByRole("status", { name: "Venue loading progress" });
    expect(status).toHaveTextContent("Paper scan");
    expect(status).toHaveTextContent("25/100");
    expect(status).toHaveTextContent("Scanning papers...");
    expect(container.querySelector<HTMLElement>(".load-progress-fill")).toHaveStyle({ width: "25%" });
  });

  it("uses an indeterminate bar before a total is available", () => {
    const { container } = render(
      createElement(LoadProgressPanel, {
        progress: { ...baseProgress, phase: "venue", message: "Starting venue load...", current: 0, total: 0 }
      })
    );

    expect(screen.getByRole("status", { name: "Venue loading progress" })).toHaveTextContent("Working");
    expect(container.querySelector(".load-progress-track")).toHaveClass("indeterminate");
    expect(container.querySelector(".load-progress-fill")).toHaveClass("indeterminate");
  });

  it("stops the indeterminate animation when loading fails", () => {
    const { container } = render(
      createElement(LoadProgressPanel, {
        progress: {
          ...baseProgress,
          phase: "error",
          message: "Could not load the selected venue.",
          current: 0,
          total: 0,
          done: true,
          error: "Could not load the selected venue."
        }
      })
    );

    expect(screen.getByRole("status", { name: "Venue loading progress" })).toHaveTextContent("Failed");
    expect(container.querySelector(".load-progress-track")).not.toHaveClass("indeterminate");
    expect(container.querySelector(".load-progress-fill")).not.toHaveClass("indeterminate");
  });
});
