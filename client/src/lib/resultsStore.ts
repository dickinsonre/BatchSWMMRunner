import type { ProcessResult } from "@/components/ResultsDisplay";

let storedResults: ProcessResult[] = [];
let storedElapsedTime: string | undefined;

export function setDashboardResults(results: ProcessResult[], elapsedTime?: string) {
  storedResults = results;
  storedElapsedTime = elapsedTime;
}

export function getDashboardResults(): { results: ProcessResult[]; elapsedTime?: string } {
  return { results: storedResults, elapsedTime: storedElapsedTime };
}

export function hasDashboardResults(): boolean {
  return storedResults.length > 0;
}
