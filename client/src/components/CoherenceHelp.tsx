import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const coherenceHelp = {
  dt: "Time step in seconds used only in the Courant screening calculation: R-Δt = L / ((|V| + c) × Δt). By default each engine uses its reported routing step, with INP fallback. Entering a value overrides both sides. A larger step lowers this margin and can flag more conduits. Must be positive. This does not rerun or change the simulation.",
  threshold: "R* is the dimensionless review threshold, normally 1. The weakest valid margin below R* triggers review; margins from R* to below 1.25 × R* trigger watch. Higher thresholds are more conservative. Missing evidence can remain unknown. Must be positive. Clear does not prove stability.",
  closed: "Closed-conduit crown-proximity threshold. d is water depth; D is full conduit depth. Default 0.90 means 90% full. R-crown = (1 − d/D) / (1 − onset); at R* = 1, depths above this onset trigger review. Lower onset flags shallower flows. Allowed range: 0 to less than 1. Screening only; pipe geometry is unchanged.",
  open: "Open-channel bankfull-proximity threshold. d is water depth; D is the section's full depth. Default 0.95 means 95% of full depth. Uses the same crown-margin formula as closed conduits. Lower onset flags shallower flows. Allowed range: 0 to less than 1. This does not change the channel or simulation.",
  dry: "Concurrent-series dry guard. Periods with d/D at or below this value are excluded from screening; 0.02 means 2% of full depth. This avoids misleading hydraulic flags in nearly dry conduits. All-dry series remain unknown, not clear. Applies only to concurrent screening, not report maxima. Allowed range: 0 to less than 1.",
  surcharge: "How the screen estimates wave celerity near a closed-conduit crown. Follow each run uses that engine's reported surcharge method, with INP fallback. EXTRAN and SLOT force a screening assumption on both sides, not a new simulation. Unmodelled methods such as SWMM6 DYNAMIC_SLOT remain unknown near the crown when following the run.",
  evidence: "Auto uses concurrent link-series evidence where available, otherwise report-summary maxima. Report maxima may combine depth and velocity from different times. Concurrent only uses depth and velocity from the same recorded period; missing, invalid, or truncated series are identified rather than treated as zero. Recorded periods are not every internal solver step.",
  source: "Effective screening settings for each engine. Report means read from that engine's RPT; INP means fallback to the input model; manual means your override. Without an override, the two engines can use different routing steps and surcharge methods.",
  reset: "Remove the manual time-step override and restore each engine's own reported routing step, falling back to its INP value. Other screening settings are unchanged.",
  csv: "Download the currently filtered conduit rows as CSV, including both engines' screening metrics, evidence/status fields, flag transitions, and report-diagnostic overlap. This is a diagnostic table, not the native INP/RPT/OUT export.",
} as const;

/** Focusable help triggers also support tapping, without changing the labelled control. */
export function CoherenceHelp({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Help: ${label}`}
            className="inline-flex shrink-0 items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={event => { event.preventDefault(); setOpen(true); }}
          >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal text-xs font-normal leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}