import { describe, expect, it } from "vitest";
import { parseJournalDraft } from "./journal-draft";

describe("parseJournalDraft", () => {
  it("restores valid text and trade tags", () => {
    expect(parseJournalDraft('{"body":"saved notes","tag":"Funded"}')).toEqual({
      body: "saved notes",
      tag: "Funded",
    });
  });

  it("fails closed for corrupt or oversized drafts", () => {
    expect(parseJournalDraft("not-json")).toEqual({ body: "", tag: null });
    expect(parseJournalDraft(JSON.stringify({ body: "x".repeat(5001), tag: "Other" })))
      .toEqual({ body: "x".repeat(5000), tag: null });
  });
});
