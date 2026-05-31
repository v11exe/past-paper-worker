import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReviewAiActions } from "./ReviewAiActions";

describe("ReviewAiActions", () => {
  it("dismisses the follow-up card from its close button", async () => {
    const user = userEvent.setup();
    const onDismissFollowUp = vi.fn();

    render(
      <ReviewAiActions
        limited={false}
        used={1}
        remaining={2}
        busyAction={null}
        followUpText="How would you justify that point more precisely?"
        error={null}
        onFollowUp={vi.fn()}
        onDismissFollowUp={onDismissFollowUp}
      />,
    );

    await user.click(screen.getByRole("button", { name: /close follow-up question/i }));

    expect(onDismissFollowUp).toHaveBeenCalledTimes(1);
  });
});
