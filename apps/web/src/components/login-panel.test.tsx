import { createElement, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { LoginPanel } from "@/components/login-panel";

const defaultVenueId = "aclweb.org/ACL/ARR/2026/May";

type LoginHarnessProps = {
  isBusy?: boolean;
  onLogin?: (username: string, password: string, venueId: string) => Promise<void>;
};

function LoginHarness({ isBusy = false, onLogin = vi.fn(async () => undefined) }: LoginHarnessProps) {
  const [venueId, setVenueId] = useState(defaultVenueId);

  return createElement(LoginPanel, {
    error: null,
    isBusy,
    onLogin,
    onVenueIdChange: setVenueId,
    venueId
  });
}

describe("LoginPanel", () => {
  it("renders as an inline section without modal behavior", () => {
    const { container } = render(createElement(LoginHarness, {}));

    expect(screen.getByRole("region", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(container.querySelector(".modal-backdrop")).not.toBeInTheDocument();
    expect(
      screen.getByText(/credentials are sent to the official openreview api over https/i)
    ).toBeInTheDocument();
  });

  it("submits the credentials and controlled venue in one action", async () => {
    const onLogin = vi.fn(async () => undefined);
    render(createElement(LoginHarness, { onLogin }));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/openreview email/i), " chair@example.com ");
    await user.type(screen.getByLabelText("Password"), "secret");
    const venueInput = screen.getByLabelText("Venue ID");
    await user.clear(venueInput);
    await user.type(venueInput, " aclweb.org/ACL/ARR/2026/May ");
    await user.click(screen.getByRole("button", { name: "Sign in & load venue" }));

    expect(onLogin).toHaveBeenCalledWith(
      "chair@example.com",
      "secret",
      "aclweb.org/ACL/ARR/2026/May"
    );
  });

  it("clears the password after submission while preserving the other fields", async () => {
    const onLogin = vi.fn(async () => undefined);
    render(createElement(LoginHarness, { onLogin }));
    const user = userEvent.setup();
    const usernameInput = screen.getByLabelText(/openreview email/i);
    const passwordInput = screen.getByLabelText("Password");

    await user.type(usernameInput, "chair@example.com");
    await user.type(passwordInput, "secret");
    await user.click(screen.getByRole("button", { name: "Sign in & load venue" }));

    expect(passwordInput).toHaveValue("");
    expect(usernameInput).toHaveValue("chair@example.com");
    expect(screen.getByLabelText("Venue ID")).toHaveValue(defaultVenueId);
  });

  it("disables the complete form and reports progress while busy", () => {
    render(createElement(LoginHarness, { isBusy: true }));

    expect(screen.getByRole("region", { name: "Sign in" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText(/openreview email/i)).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByLabelText("Venue ID")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Signing in & loading..." })).toBeDisabled();
  });
});
