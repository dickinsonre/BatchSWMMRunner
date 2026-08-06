import { Link, useLocation } from "wouter";
import { ArrowRight, Droplets, Users, Gift, Map, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import AppHeader from "@/components/AppHeader";

export const PITCH_SEEN_KEY = "batchswmm-pitch-seen";

const nextSteps: { title: string; detail: string; done?: boolean }[] = [
  {
    title: "Verify graphs for in-browser (WASM) runs on real models",
    detail: "Confirm the new time-series charts work end-to-end for browser-based SWMM5 and SWMM6 runs — in progress now.",
  },
  {
    title: "Surface every SWMM warning and error per file",
    detail: "Engineers should see the full list of engine warnings (including SWMM6's extra link-depth checks), not just a count.",
  },
  {
    title: "Keep big batches fast",
    detail: "Stop very large simulation results from freezing batch processing, and confirm cancel/timeout always stop long runs.",
  },
  {
    title: "Harden quality",
    detail: "Fix or flag broken bundled sample models, and add automated regression tests on real-world models so fake or missing results never ship.",
  },
  {
    title: "Slim the project",
    detail: "Remove thousands of old uploaded files from version control to keep the repo lean.",
  },
];

export default function ElevatorPitch() {
  const [, navigate] = useLocation();

  const getStarted = () => {
    try { localStorage.setItem(PITCH_SEEN_KEY, "1"); } catch { /* ignore */ }
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="container max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12 flex-1 space-y-8">
        <div className="text-center space-y-4">
          <Badge variant="secondary" data-testid="badge-pitch">Elevator Pitch</Badge>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight" data-testid="text-pitch-title">
            Run a whole folder of SWMM models. Get answers, not busywork.
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto" data-testid="text-pitch-subtitle">
            BatchSWMM56 is a batch runner for EPA SWMM5, SWMM6 and other SWMM engines — the
            industry-standard stormwater and sewer simulators — with four engine modes,
            instant graphs, and AI-assisted reports.
          </p>
          <Button size="lg" onClick={getStarted} data-testid="button-get-started">
            Get Started <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Card data-testid="card-pitch-what">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Droplets className="h-4 w-4 text-primary" /> What it does
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>Upload one or a hundred .inp models and run them all in one click — sequentially, with live progress.</p>
              <p>Choose your engine: the native EPA SWMM 5.2 executable, the SWMM5 API with live step-by-step data, or WebAssembly builds of SWMM5 and OpenSWMM "SWMM6" 5.3 that run entirely in your browser.</p>
            </CardContent>
          </Card>
          <Card data-testid="card-pitch-who">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Who it's for
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>Stormwater and wastewater engineers running design alternatives, calibration sweeps, or model QA.</p>
              <p>Reviewers and students exploring 100+ bundled sample models. Modelers comparing engine versions — including SWMM6's extra link-depth validation warnings.</p>
            </CardContent>
          </Card>
          <Card data-testid="card-pitch-get">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Gift className="h-4 w-4 text-primary" /> What you get
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>Per-file pass/fail status, continuity errors, full report text, interactive time-series graphs, key charts and histograms.</p>
              <p>CSV/Excel/PDF exports, an AI report assistant, ReSWMM conduit lengthening, and an HTTP API plus deep links so scripts and browser agents can drive it.</p>
            </CardContent>
          </Card>
        </div>

        <Card data-testid="card-pitch-roadmap">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Map className="h-4 w-4 text-primary" /> Next steps in the making of this app
            </CardTitle>
            <p className="text-sm text-muted-foreground">Where development is headed from here:</p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {nextSteps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm" data-testid={`roadmap-item-${i}`}>
                  {step.done
                    ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    : <Circle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
                  <div>
                    <span className="font-medium">{step.title}</span>
                    <p className="text-muted-foreground">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="text-center">
          <Button variant="outline" asChild data-testid="button-pitch-docs">
            <Link href="/docs">Read the full documentation</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
