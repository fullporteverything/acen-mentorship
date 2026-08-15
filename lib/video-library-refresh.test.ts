import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announceVideoUploaded,
  hasProcessingVideo,
  VIDEO_UPLOADED_EVENT,
  type LibraryVideo,
} from "./video-library-client";

const video = (patch: Partial<LibraryVideo>): LibraryVideo => ({
  id: "video-a",
  title: "Lecture",
  createdAt: "2026-08-01T12:00:00.000Z",
  duration: 60,
  status: "done",
  progress: null,
  ready: true,
  attachedTo: null,
  ...patch,
});

describe("processing detection", () => {
  it("keeps polling only while a row is still mid-flight", () => {
    const transcoding = video({
      id: "video-b",
      status: "processing",
      progress: 40,
      ready: false,
    });

    // A row that is neither playable nor failed will change on its own.
    expect(hasProcessingVideo([transcoding])).toBe(true);
    expect(hasProcessingVideo([video({}), transcoding])).toBe(true);

    // Settled rows — done, or failed for good — must stop the poll.
    expect(hasProcessingVideo([video({})])).toBe(false);
    expect(
      hasProcessingVideo([
        video({ status: "error", ready: false, error: "Video processing failed." }),
      ])
    ).toBe(false);
    expect(hasProcessingVideo([])).toBe(false);
  });
});

describe("upload announcement", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dispatches the refetch signal with the new video id", () => {
    const received: string[] = [];
    const target = new EventTarget();
    target.addEventListener(VIDEO_UPLOADED_EVENT, (event) => {
      received.push((event as CustomEvent<{ videoId: string }>).detail.videoId);
    });
    vi.stubGlobal("window", target);

    announceVideoUploaded("video-a");

    expect(received).toEqual(["video-a"]);
  });

  it("is inert on the server, where there is no window to dispatch on", () => {
    vi.stubGlobal("window", undefined);
    expect(() => announceVideoUploaded("video-a")).not.toThrow();
  });
});
