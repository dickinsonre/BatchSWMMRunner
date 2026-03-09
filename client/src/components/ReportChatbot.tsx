import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Download, Loader2, Sparkles, Trash2, ChevronDown, ChevronRight } from "lucide-react";

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

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const reportCategories: { label: string; reports: { title: string; prompt: string }[] }[] = [
    {
      label: "System Performance",
      reports: [
        { title: "Professional HTML Report", prompt: "Generate a professional HTML report with all summary tables, continuity errors, flooding summary, and hydrology comparison." },
        { title: "Executive Summary", prompt: "Create an executive summary report with key findings, charts, and actionable recommendations." },
        { title: "System Mass Balance", prompt: "Generate a report showing the system-wide water balance: total precipitation, total infiltration, total runoff, total inflow, total flooding, total outflow, and continuity errors for both runoff and routing. Flag any continuity errors exceeding 1%." },
        { title: "Model Health Check", prompt: "Create a diagnostic report identifying potential model issues: continuity errors, unconverged timesteps, dry nodes, zero-flow conduits, nodes that never receive flow, and conduits with flow reversals. Summarize overall model health with a traffic-light rating." },
        { title: "Simulation Performance", prompt: "Build a report on simulation runtime performance: total elapsed time, number of timesteps, average timestep, minimum timestep used, number of timestep reductions, and routing stability metrics. Include recommendations if the model shows instability." },
        { title: "Rainfall-Runoff Summary", prompt: "Generate a report summarizing the rainfall event characteristics (total depth, peak intensity, duration) and corresponding runoff response (total runoff volume, peak flow at outfalls, runoff coefficient per subcatchment, and system-wide runoff coefficient)." },
      ],
    },
    {
      label: "Node Analysis",
      reports: [
        { title: "Flooding Analysis", prompt: "Make a report focused on flooding analysis and node surcharging: all nodes that experienced flooding, total flood volume per node, maximum flood rate, duration of flooding, time of first flooding, and a ranked list from worst to least." },
        { title: "Node Depth Exceedance", prompt: "Create a report showing all nodes where maximum water depth exceeded 80% of maximum depth. Include node ID, max depth, crown elevation, rim elevation, time of maximum, duration above 80%, and flag any nodes with actual surface flooding." },
        { title: "Node Inflow Analysis", prompt: "Generate a report listing all nodes with external inflows: dry weather flow, direct inflow, RDII, and total inflow per node. Show peak inflow rate and time of peak for each. Identify the top 10 nodes by peak inflow." },
        { title: "Surcharging Duration", prompt: "Create a report of all nodes that experienced surcharging: node ID, maximum HGL elevation, duration of surcharging, maximum surcharge depth above crown, and time of first surcharging. Rank by total surcharge duration." },
        { title: "Outfall Loading Summary", prompt: "Build a report summarizing discharge at all outfall nodes: total volume discharged, peak flow rate, time of peak, average flow rate, and flow duration. If water quality is simulated, include total pollutant mass discharged per outfall." },
        { title: "Freeboard Analysis", prompt: "Generate a report for all nodes showing the difference between rim elevation and maximum water surface elevation (freeboard). Flag nodes with freeboard less than 300mm. Include a ranked list from least freeboard to most." },
      ],
    },
    {
      label: "Conduit/Link Analysis",
      reports: [
        { title: "Conduit Capacity", prompt: "Build a conduit capacity report comparing peak flow in each conduit against pipe-full capacity (Manning's equation). Show conduit ID, diameter, slope, Manning's n, pipe-full capacity, peak simulated flow, percent utilization, and flag conduits exceeding 100%." },
        { title: "Conduit Velocity", prompt: "Create a report showing all conduits with maximum velocity exceeding 3 m/s and all conduits with maximum velocity below 0.6 m/s. Include conduit ID, upstream/downstream nodes, diameter, slope, max velocity, max flow, and a self-cleansing assessment." },
        { title: "Conduit d/D Ratio", prompt: "Generate a report showing the maximum depth-to-diameter ratio for every conduit. Flag conduits exceeding 0.80 d/D in amber and 1.0 d/D in red. Include conduit geometry, slope, max flow, and the time when maximum d/D occurred." },
        { title: "Pipe Surcharging", prompt: "Build a report of all conduits that experienced surcharging: conduit ID, diameter, length, slope, duration of surcharging, maximum HGL at upstream and downstream nodes, and maximum surcharge head above the pipe crown." },
        { title: "Slope & Gradient Audit", prompt: "Generate a report listing all conduits with their upstream invert, downstream invert, length, calculated slope, and Manning's n. Flag adverse slopes (negative), flat slopes (<0.1%), and excessively steep slopes (>10%). Include a histogram of slope distribution." },
        { title: "Flow Reversal", prompt: "Create a report identifying all conduits that experienced flow reversal during the simulation: conduit ID, number of reversal events, maximum reverse flow rate, duration of reversal, and likely cause (downstream surcharging, tidal boundary, etc.)." },
        { title: "Conduit Length-Diameter Summary", prompt: "Build a table of all conduits showing: ID, shape, diameter/dimensions, length, slope, Manning's n, upstream node, downstream node. Group by pipe material or diameter range and show total length per group." },
      ],
    },
    {
      label: "Subcatchment Reports",
      reports: [
        { title: "Subcatchment Runoff Summary", prompt: "Generate a table of all subcatchments: area, percent impervious, slope, width, infiltration parameters, total rainfall, total infiltration, total runoff, peak runoff rate, time of peak, and runoff coefficient. Rank by peak runoff rate." },
        { title: "Imperviousness Audit", prompt: "Create a report analyzing imperviousness across all subcatchments: directly connected impervious area, total impervious area, percent with no depression storage, and the resulting effective impervious fraction. Highlight outliers." },
        { title: "LID Performance", prompt: "Generate a report on all Low Impact Development controls: LID type, area, number of units, total inflow captured, total outflow, overflow volume, drain flow, infiltration volume, evaporation, and overall percent capture." },
        { title: "Groundwater Summary", prompt: "Build a report on all subcatchments with groundwater simulation: initial water table elevation, final water table elevation, peak groundwater flow to drainage system, total groundwater volume contributed, and lateral/deep percolation losses." },
      ],
    },
    {
      label: "Hydraulic Design",
      reports: [
        { title: "HGL Profile", prompt: "Build a report showing the maximum hydraulic grade line profile along major trunk routes. Include: node ID, ground elevation, invert elevation, maximum HGL elevation, maximum depth, freeboard, and a text-based profile representation." },
        { title: "Pump Station Performance", prompt: "Generate a report for all pump links: pump ID, pump curve reference, number of start-stop cycles, total pumped volume, maximum flow rate, total energy consumption (if available), percent of time running, and maximum wet well depth." },
        { title: "Weir & Orifice Activation", prompt: "Create a report listing all weir and orifice links: structure ID, type, dimensions, crest/invert elevation, maximum flow through the structure, total volume passed, time of first activation, and duration of flow." },
        { title: "Storage Unit Performance", prompt: "Build a report for all storage nodes: storage ID, storage curve type, maximum volume, maximum depth, peak inflow, peak outflow, total inflow volume, total outflow volume, maximum surface area, and time of peak storage." },
        { title: "Detention Basin Sizing", prompt: "Generate a report for each storage unit comparing: required detention volume, available volume, peak inflow, peak outflow, maximum stored volume, percent of volume utilized, and outflow vs. allowable release rate." },
      ],
    },
    {
      label: "Model QA/QC",
      reports: [
        { title: "Input Data Audit", prompt: "Generate a comprehensive audit of all input parameters: subcatchment parameters (area, width, slope, imperviousness, Manning's n), conduit parameters (diameter, length, slope, roughness), and node parameters (invert, max depth). Flag missing, zero, or out-of-range values." },
        { title: "Connectivity Check", prompt: "Build a network connectivity report: total number of nodes, links, subcatchments, and outfalls. Identify disconnected nodes, orphan subcatchments, dead-end conduits, and nodes with no downstream path to an outfall." },
        { title: "Manning's n Summary", prompt: "Create a report grouping all conduits by Manning's roughness value: count, total length, and diameter range per roughness value. Flag any unusual values (n < 0.010 or n > 0.030 for pipes, n < 0.020 or n > 0.150 for channels)." },
        { title: "Subcatchment-to-Node Assignment", prompt: "Build a report mapping every subcatchment to its outlet node: subcatchment ID, area, outlet node, and total contributing area per node. Flag nodes receiving disproportionately large or small contributing areas." },
      ],
    },
    {
      label: "Regulatory & Compliance",
      reports: [
        { title: "Design Storm Compliance", prompt: "Create a report assessing system performance against design criteria: no flooding for the 10-year storm, no surcharging for the 5-year storm. List all nodes and conduits that fail each criterion." },
        { title: "CSO Activation", prompt: "Build a Combined Sewer Overflow report: CSO location, number of activations, total overflow volume, maximum overflow rate, total duration of overflow, and average overflow concentration for each pollutant." },
        { title: "Stormwater Management Compliance", prompt: "Create a regulatory-style summary: total impervious area, total site runoff volume, peak discharge at each discharge point, detention provided, treatment provided (LID summary), and comparison against local ordinance requirements." },
      ],
    },
    {
      label: "Specialized",
      reports: [
        { title: "Energy Loss Summary", prompt: "Generate a report showing head losses through the system: friction losses per conduit, entrance/exit losses at junctions, losses through special structures (weirs, orifices, pumps), and total head loss along major trunk routes." },
        { title: "I&I Analysis", prompt: "Build a report quantifying rainfall-dependent infiltration and inflow: RDII volume per subcatchment, RDII as percent of total flow, peak RDII rate, and comparison of dry weather flow to wet weather flow at key monitoring nodes." },
        { title: "Calibration Comparison", prompt: "Generate a report comparing simulated results against observed monitoring data: observed vs. modeled peak flow, volume, and time to peak at each gauge location, Nash-Sutcliffe efficiency, R-squared, and RMSE per gauge." },
        { title: "Asset Condition Priority", prompt: "Build a report ranking conduits by rehabilitation priority based on: utilization ratio, surcharging frequency, velocity adequacy, slope adequacy, and contributing population/area. Assign a composite priority score." },
      ],
    },
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
              <div className="flex flex-col gap-3 h-full overflow-y-auto">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">AI Report Builder</span>
                  <Badge variant="secondary" className="text-[10px]">{reportCategories.reduce((s, c) => s + c.reports.length, 0)} templates</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Pick a template below or describe your own custom report. The AI has access to your full SWMM simulation data.
                </p>
                <div className="space-y-1">
                  {reportCategories.map((cat, ci) => (
                    <div key={ci}>
                      <button
                        className="flex items-center gap-2 w-full text-left text-xs font-medium py-1.5 px-2 rounded hover-elevate"
                        onClick={() => setExpandedCategory(expandedCategory === cat.label ? null : cat.label)}
                        data-testid={`button-category-${ci}`}
                      >
                        {expandedCategory === cat.label ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {cat.label}
                        <Badge variant="outline" className="text-[10px] ml-auto no-default-hover-elevate no-default-active-elevate">{cat.reports.length}</Badge>
                      </button>
                      {expandedCategory === cat.label && (
                        <div className="ml-5 space-y-0.5 mt-0.5 mb-1">
                          {cat.reports.map((r, ri) => (
                            <button
                              key={ri}
                              className="w-full text-left text-xs py-1.5 px-2 rounded text-muted-foreground hover-elevate"
                              onClick={() => {
                                setInput(r.prompt);
                                inputRef.current?.focus();
                              }}
                              data-testid={`button-report-${ci}-${ri}`}
                            >
                              {r.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
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
