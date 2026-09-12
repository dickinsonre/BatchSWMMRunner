import { describe, expect, it, vi } from "vitest";
import { runWasmMatrix } from "../client/src/lib/wasmMatrixRunner";
import type { MatrixVariant } from "@shared/inpOptions";

const variants: MatrixVariant[] = [
  { label: "RS 5s", overrides: { routingStepSeconds: 5 } },
  { label: "RS 15s", overrides: { routingStepSeconds: 15 } },
  { label: "RS 30s", overrides: { routingStepSeconds: 30 } },
];

describe("runWasmMatrix", () => {
  it("cancels the active solver batch, dispatches no later variants, and never completes the matrix", async () => {
    const cancelRef = { current: false };
    const activeCancels: Array<(() => void) | null> = [];
    const matrixComplete = vi.fn();
    const batches: Array<{ onComplete: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
    const startVariant = vi.fn((_run, onComplete: () => void) => {
      const cancel = vi.fn();
      batches.push({ onComplete, cancel });
      return Object.assign(cancel, { skip: vi.fn() });
    });

    const matrix = runWasmMatrix({
      variants,
      baseFile: { id: "model", name: "model.inp", file: new File(["[TITLE]\ntest"], "model.inp") },
      cancelRef,
      setActiveCancel: (cancel) => activeCancels.push(cancel),
      startVariant,
      onComplete: matrixComplete,
    });

    await Promise.resolve();
    expect(startVariant).toHaveBeenCalledTimes(1);
    expect(startVariant.mock.calls[0][0].name).toBe("model [RS 5s].inp");

    // Finish the first variant so the second one is actively running.
    batches[0].onComplete();
    await Promise.resolve();
    await Promise.resolve();
    expect(startVariant).toHaveBeenCalledTimes(2);
    expect(startVariant.mock.calls[1][0].name).toBe("model [RS 15s].inp");

    // This models the UI cancel action: flag the matrix first, then stop its
    // currently in-flight batch. A cancelled batch never invokes onComplete.
    cancelRef.current = true;
    activeCancels.at(-1)?.();

    await expect(matrix).resolves.toBe(false);
    expect(startVariant.mock.calls.map(([run]) => run.name)).toEqual([
      "model [RS 5s].inp",
      "model [RS 15s].inp",
    ]);
    expect(batches[0].cancel).not.toHaveBeenCalled();
    expect(batches[1].cancel).toHaveBeenCalledTimes(1);
    expect(matrixComplete).not.toHaveBeenCalled();
    expect(activeCancels.at(-1)).toBeNull();
  });
});