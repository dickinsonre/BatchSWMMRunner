import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Download, Loader2, Sparkles, Trash2 } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ReportChatbotProps {
  reportContent: string;
  inpContent?: string;
  fileName: string;
}

function extractHtmlFromResponse(content: string): string | null {
  const match = content.match(/```html\s*([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

export default function ReportChatbot({ reportContent, inpContent, fileName }: ReportChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsStreaming(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMsg]);

    try {
      const response = await fetch("/api/chat-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          reportContent,
          inpContent,
        }),
      });

      if (!response.ok) throw new Error("Request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.content) {
              fullContent += event.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: fullContent };
                return updated;
              });
            }
            if (event.error) {
              fullContent += `\n\n**Error:** ${event.error}`;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: fullContent };
                return updated;
              });
            }
          } catch {}
        }
      }

      const html = extractHtmlFromResponse(fullContent);
      if (html) setPreviewHtml(html);
    } catch (err: any) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: `Sorry, something went wrong: ${err.message}`,
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const downloadHtml = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.inp$/i, "")}_custom_report.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestions = [
    "Generate a professional HTML report with all summary tables",
    "Create an executive summary report with key findings and charts",
    "Make a report focused on flooding analysis and node surcharging",
    "Build a conduit capacity report with flow vs. design comparisons",
  ];

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/30 rounded-t border border-b-0"
            style={{ minHeight: "300px", maxHeight: "500px" }}
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
                <Sparkles className="h-10 w-10" />
                <p className="text-sm font-medium">AI Report Builder</p>
                <p className="text-xs text-center max-w-sm">
                  Describe the custom HTML report you want. The AI has access to your full SWMM simulation data and can generate professional reports.
                </p>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {suggestions.map((s, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="text-xs max-w-[220px] h-auto whitespace-normal text-left py-2"
                      onClick={() => {
                        setInput(s);
                        inputRef.current?.focus();
                      }}
                      data-testid={`button-suggestion-${i}`}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={`rounded-lg px-3 py-2 max-w-[80%] text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card border"
                  }`}
                  data-testid={`text-chat-message-${i}`}
                >
                  {msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
                  {msg.role === "assistant" && i === messages.length - 1 && isStreaming && (
                    <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center">
                    <User className="h-4 w-4 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 p-3 border rounded-b bg-background">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the report you want..."
              className="flex-1 resize-none bg-transparent text-sm outline-none min-h-[36px] max-h-[100px] py-2"
              rows={1}
              disabled={isStreaming}
              data-testid="input-chat-message"
            />
            {messages.length > 0 && !isStreaming && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setMessages([]);
                  setPreviewHtml(null);
                }}
                data-testid="button-clear-chat"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="icon"
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              data-testid="button-send-chat"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {previewHtml && (
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border rounded-t bg-muted/50">
              <span className="text-xs font-medium text-muted-foreground">HTML Preview</span>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadHtml}
                data-testid="button-download-custom-report"
              >
                <Download className="h-3 w-3 mr-1" />
                Download HTML
              </Button>
            </div>
            <div className="flex-1 border border-t-0 rounded-b overflow-auto bg-white" style={{ minHeight: "300px", maxHeight: "500px" }}>
              <iframe
                srcDoc={previewHtml}
                className="w-full h-full border-0"
                title="Report Preview"
                sandbox="allow-same-origin"
                style={{ minHeight: "500px" }}
                data-testid="iframe-report-preview"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function renderMarkdown(text: string): React.ReactNode {
  const htmlBlock = text.match(/```html\s*([\s\S]*?)```/);
  if (htmlBlock) {
    const before = text.substring(0, htmlBlock.index);
    const after = text.substring(htmlBlock.index! + htmlBlock[0].length);
    return (
      <>
        {before && <span>{before}</span>}
        <div className="my-2 p-2 bg-muted rounded text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto">
          <span className="text-muted-foreground">HTML report generated (see preview)</span>
        </div>
        {after && <span>{after}</span>}
      </>
    );
  }

  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}
