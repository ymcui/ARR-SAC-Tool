import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AccountMenu } from "@/components/account-menu";

const baseProps = {
  viewer: { id: "~Test_SAC1", fullname: "Test SAC" },
  venueId: "aclweb.org/ACL/ARR/2026/March",
  recentVenueIds: [],
  isBusy: false,
  isLoadingDashboard: false,
  isLoggingOut: false,
  onLoadOrRefresh: vi.fn(),
  onLogout: vi.fn()
};

describe("AccountMenu", () => {
  it("reveals venue controls and standalone logout from the username trigger", async () => {
    const onLoadOrRefresh = vi.fn();
    const onLogout = vi.fn();
    render(createElement(AccountMenu, { ...baseProps, onLoadOrRefresh, onLogout }));
    const user = userEvent.setup();

    const trigger = screen.getByRole("button", { name: "Test SAC" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Venue ID")).not.toBeInTheDocument();

    await user.click(trigger);
    const input = screen.getByLabelText("Venue ID");
    expect(input).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load / Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, " aclweb.org/ACL/2026/Conference ");
    await user.click(screen.getByRole("button", { name: "Load / Refresh" }));

    expect(onLoadOrRefresh).toHaveBeenCalledWith("aclweb.org/ACL/2026/Conference");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    await user.click(screen.getByLabelText("Venue ID"));
    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("closes on outside interaction and restores trigger focus on Escape", async () => {
    render(createElement(AccountMenu, baseProps));
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Test SAC" });

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: /account and venue settings/i })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: /account and venue settings/i })).not.toBeInTheDocument();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /account and venue settings/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows recent venues only after input interaction and filters them by the draft", async () => {
    render(
      createElement(AccountMenu, {
        ...baseProps,
        recentVenueIds: [
          "aclweb.org/ACL/ARR/2026/March",
          "aclweb.org/ACL/ARR/2026/May",
          "aclweb.org/ACL/2026/Conference"
        ]
      })
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Test SAC" }));
    const input = screen.getByLabelText("Venue ID");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(input);
    expect(screen.getByRole("option", { name: "aclweb.org/ACL/ARR/2026/March" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "aclweb.org/ACL/ARR/2026/May" })).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "conference");
    expect(screen.getByRole("option", { name: "aclweb.org/ACL/2026/Conference" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "aclweb.org/ACL/ARR/2026/March" })).not.toBeInTheDocument();
  });

  it("keeps logout available while a venue load is running", async () => {
    const onLogout = vi.fn();
    render(
      createElement(AccountMenu, {
        ...baseProps,
        isBusy: true,
        isLoadingDashboard: true,
        onLogout
      })
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Test SAC" }));

    expect(screen.getByLabelText("Venue ID")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Loading..." })).toBeDisabled();
    const logoutButton = screen.getByRole("button", { name: "Logout" });
    expect(logoutButton).toBeEnabled();
    expect(logoutButton).toHaveFocus();

    await user.click(logoutButton);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("marks long viewer names for bounded, full-text display", () => {
    const longName = "A Very Long OpenReview Display Name That Must Not Expand The Entire Header";
    render(
      createElement(AccountMenu, {
        ...baseProps,
        viewer: { ...baseProps.viewer, fullname: longName }
      })
    );

    const name = screen.getByTitle(longName);
    expect(name).toHaveClass("account-menu-name");
    expect(screen.getByRole("button", { name: longName })).toContainElement(name);
  });
});
