import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  KinescopeIntegrationError,
  getKinescopeConfig,
  kinescopeFetch,
  normalizeKinescopeVideo,
} from "./kinescope";

const VALID_ID = "57c95d80-7a5b-43f5-b3c9-7fbabb5c54f0";
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("getKinescopeConfig", () => {
  it("requires every server-only Kinescope setting", () => {
    delete process.env.KINESCOPE_API_TOKEN;
    delete process.env.KINESCOPE_PROJECT_ID;
    delete process.env.KINESCOPE_PLAYER_ID;

    expect(() => getKinescopeConfig()).toThrow(KinescopeIntegrationError);
    expect(() => getKinescopeConfig()).toThrow("Kinescope is not configured.");
  });

  it("returns the complete configured server-side values", () => {
    process.env.KINESCOPE_API_TOKEN = "token";
    process.env.KINESCOPE_PROJECT_ID = "project";
    process.env.KINESCOPE_PLAYER_ID = "player";

    expect(getKinescopeConfig()).toEqual({
      apiToken: "token",
      projectId: "project",
      playerId: "player",
    });
  });
});

describe("normalizeKinescopeVideo", () => {
  it.each([
    ["pending", false],
    ["uploading", false],
    ["pre-processing", false],
    ["processing", false],
    ["done", true],
    ["aborted", false],
    ["error", false],
  ])("marks %s videos ready only when done", (status, ready) => {
    expect(
      normalizeKinescopeVideo({ id: VALID_ID, title: "Lesson", status })
    ).toMatchObject({ id: VALID_ID, title: "Lesson", status, ready });
  });

  it("coerces numeric duration and progress values", () => {
    expect(
      normalizeKinescopeVideo({
        id: VALID_ID,
        title: "Lesson",
        status: "processing",
        duration: "90.5",
        progress: "65",
      })
    ).toMatchObject({ duration: 90.5, progress: 65 });
  });

  it("rejects malformed provider responses", () => {
    expect(() => normalizeKinescopeVideo(null)).toThrow(KinescopeIntegrationError);
    expect(() => normalizeKinescopeVideo({ title: "Lesson" })).toThrow(
      KinescopeIntegrationError
    );
  });

  it.each(["aborted", "error"])(
    "replaces unsafe %s diagnostics with a fixed message",
    (status) => {
      const video = normalizeKinescopeVideo({
        id: VALID_ID,
        title: "Lesson",
        status,
        error: "<html>Bearer provider-secret-token</html>",
      });

      expect(video.error).toBe("Video processing failed.");
      expect(video.error).not.toContain("provider-secret-token");
      expect(video.error).not.toContain("<html>");
    }
  );
});

describe("kinescopeFetch", () => {
  it("uses server credentials and JSON headers without allowing overrides", async () => {
    process.env.KINESCOPE_API_TOKEN = "secret-token";
    process.env.KINESCOPE_PROJECT_ID = "project";
    process.env.KINESCOPE_PLAYER_ID = "player";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await kinescopeFetch("/videos", {
      method: "POST",
      headers: { Authorization: "Bearer attacker", "X-Request-ID": "request" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.kinescope.io/v1/videos");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Request-ID")).toBe("request");
  });

  it("hides provider details when the request is rejected", async () => {
    process.env.KINESCOPE_API_TOKEN = "secret-token";
    process.env.KINESCOPE_PROJECT_ID = "project";
    process.env.KINESCOPE_PLAYER_ID = "player";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("<html>Bearer provider-secret-token</html>"))
    );

    await expect(kinescopeFetch("/videos")).rejects.toThrow(
      "Kinescope integration failed."
    );
  });

  it("hides non-OK response headers and body", async () => {
    process.env.KINESCOPE_API_TOKEN = "secret-token";
    process.env.KINESCOPE_PROJECT_ID = "project";
    process.env.KINESCOPE_PLAYER_ID = "player";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Bearer provider-secret-token</html>", {
          status: 502,
          headers: { Authorization: "Bearer response-secret-token" },
        })
      )
    );

    await expect(kinescopeFetch("/videos")).rejects.toThrow(
      "Kinescope integration failed."
    );
  });
});
