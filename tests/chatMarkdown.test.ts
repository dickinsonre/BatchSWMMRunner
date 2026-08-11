import { describe, it, expect } from "vitest";
import { splitHtmlFences } from "../client/src/lib/chatMarkdown";

describe("splitHtmlFences", () => {
  it("returns plain text as a single text segment", () => {
    expect(splitHtmlFences("Here is a **table** summary.")).toEqual([
      { type: "text", content: "Here is a **table** summary." },
    ]);
  });

  it("splits a closed html fence with text before and after", () => {
    const segs = splitHtmlFences("Intro\n```html\n<html>report</html>\n```\nDone.");
    expect(segs.map((s) => s.type)).toEqual(["text", "html", "text"]);
    expect(segs[1].content).toContain("<html>report</html>");
    expect(segs[2].content).toContain("Done.");
  });

  it("hides an open fence that is still streaming in", () => {
    const segs = splitHtmlFences("Generating...\n```html\n<html><body>partial");
    expect(segs.map((s) => s.type)).toEqual(["text", "html"]);
    expect(segs[1].content).toContain("partial");
  });

  it("handles multiple fences including a trailing open one", () => {
    const segs = splitHtmlFences(
      "First:\n```html\n<p>a</p>\n```\nSecond:\n```html\n<p>b",
    );
    expect(segs.map((s) => s.type)).toEqual(["text", "html", "text", "html"]);
    expect(segs[3].content).toContain("<p>b");
  });

  it("handles two closed fences", () => {
    const segs = splitHtmlFences("```html\n<p>a</p>\n``` mid ```html\n<p>b</p>\n``` end");
    expect(segs.map((s) => s.type)).toEqual(["html", "text", "html", "text"]);
    expect(segs[1].content).toContain("mid");
    expect(segs[3].content).toContain("end");
  });

  it("does not treat other code fences as html blocks", () => {
    const segs = splitHtmlFences("```\nplain code\n```");
    expect(segs).toEqual([{ type: "text", content: "```\nplain code\n```" }]);
  });
});
