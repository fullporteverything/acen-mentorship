import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseFeed } from "@/lib/youtube-feed";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:AAA111</id>
    <yt:videoId>AAA111</yt:videoId>
    <title>First &amp; Best: &quot;HTF&quot; Narrative</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=AAA111"/>
    <published>2026-08-18T12:00:00+00:00</published>
  </entry>
  <entry>
    <id>yt:video:BBB222</id>
    <yt:videoId>BBB222</yt:videoId>
    <title>Second Video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=BBB222"/>
    <published>2026-08-17T12:00:00+00:00</published>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("extracts videos newest-first with decoded titles and canonical urls", () => {
    const videos = parseFeed(SAMPLE);
    expect(videos.map((v) => v.videoId)).toEqual(["AAA111", "BBB222"]);
    expect(videos[0].title).toBe('First & Best: "HTF" Narrative');
    expect(videos[0].url).toBe("https://www.youtube.com/watch?v=AAA111");
    expect(videos[0].publishedAt).toBe("2026-08-18T12:00:00+00:00");
  });

  it("skips malformed entries instead of throwing", () => {
    const broken = SAMPLE.replace("<yt:videoId>BBB222</yt:videoId>", "");
    const videos = parseFeed(broken);
    expect(videos.map((v) => v.videoId)).toEqual(["AAA111"]);
  });

  it("returns an empty list for a feed with no entries", () => {
    expect(parseFeed("<feed></feed>")).toEqual([]);
  });
});
