/** Splits assistant chat text into markdown segments and ```html fenced
 * report blocks (each replaced with a placeholder in the chat UI). Handles
 * multiple closed fences and a trailing fence that is still streaming in. */
export interface ChatSegment {
  type: "text" | "html";
  content: string;
}

const FENCE_OPEN = /```html\s*/g;

export function splitHtmlFences(text: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let pos = 0;
  FENCE_OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_OPEN.exec(text)) !== null) {
    if (m.index > pos) {
      segments.push({ type: "text", content: text.substring(pos, m.index) });
    }
    const bodyStart = m.index + m[0].length;
    const closeIdx = text.indexOf("```", bodyStart);
    if (closeIdx === -1) {
      // Fence still streaming in — hide everything to the end.
      segments.push({ type: "html", content: text.substring(bodyStart) });
      pos = text.length;
      break;
    }
    segments.push({ type: "html", content: text.substring(bodyStart, closeIdx) });
    pos = closeIdx + 3;
    FENCE_OPEN.lastIndex = pos;
  }
  if (pos < text.length) {
    segments.push({ type: "text", content: text.substring(pos) });
  }
  return segments;
}
