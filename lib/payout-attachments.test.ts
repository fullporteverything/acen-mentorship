import { describe, expect, it } from "vitest";

import { firstReadableImage, unreadableReason } from "./payout-attachments";

describe("picking something readable off a message", () => {
  it("takes a normal screenshot", () => {
    expect(
      firstReadableImage([{ url: "https://cdn/x.png", content_type: "image/png", size: 500 }])
    ).toEqual({ url: "https://cdn/x.png", mediaType: "image/png" });
  });

  it("falls back to the extension when Discord omits the type", () => {
    // Skipping a real screenshot over a missing header would be an invisible
    // failure — the row would just say "unreadable" forever.
    expect(firstReadableImage([{ url: "https://cdn/shot.JPG?ex=abc&is=def" }])?.mediaType)
      .toBe("image/jpeg");
  });

  it("refuses video and oversized files", () => {
    expect(firstReadableImage([{ url: "https://cdn/clip.mp4", content_type: "video/mp4" }])).toBeNull();
    expect(
      firstReadableImage([{ url: "https://cdn/x.png", content_type: "image/png", size: 99_000_000 }])
    ).toBeNull();
  });
});

describe("saying WHY nothing could be read", () => {
  it("names video specifically, because a screen recording is a reasonable thing to post", () => {
    expect(unreadableReason([{ url: "u", content_type: "video/quicktime" }]))
      .toContain("video can't be read automatically");
  });

  it("distinguishes too-large from unsupported from absent", () => {
    expect(unreadableReason([{ url: "u", content_type: "image/png", size: 99_000_000 }]))
      .toContain("too large");
    expect(unreadableReason([{ url: "u", content_type: "application/pdf" }]))
      .toContain("application/pdf");
    expect(unreadableReason([])).toContain("no attachment");
  });
});
