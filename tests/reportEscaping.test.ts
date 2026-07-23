import { describe, it, expect } from "vitest";
import { generateHTMLReport, escapeHtml } from "../client/src/lib/reportGenerator";
import type { ProcessResult } from "../shared/schema";

const maliciousName = `<img src=x onerror=alert(1)>.inp`;

function makeResult(fileName: string): ProcessResult {
  return {
    id: "f1",
    fileName,
    status: "success",
    processingTime: 1.5,
    results: { peakFlow: 10, totalVolume: 2 },
    parsedMetrics: {
      runoffContinuityError: 9.5,
      routingContinuityError: 9.5,
      nodesFlooded: 3,
      floodingLoss: 1.2,
      totalPrecipitation: 5,
      surfaceRunoff: 4,
    },
  } as ProcessResult;
}

describe("HTML report escaping", () => {
  it("escapeHtml neutralizes HTML special characters", () => {
    expect(escapeHtml(`<script>alert("x")&'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;"
    );
  });

  it("generateHTMLReport does not emit raw user-controlled HTML", () => {
    const html = generateHTMLReport([makeResult(maliciousName)]);
    expect(html).not.toContain("<img src=x onerror=");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;.inp");
  });
});
