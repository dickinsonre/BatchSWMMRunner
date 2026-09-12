import type { Swmm6Options } from "@shared/inpOptions";
import type { EngineId } from "./engineComparison";

/**
 * Keep the two OpenSWMM browser engines intentionally separate:
 * - stable (`wasm6`) receives only the four independently selectable
 *   advanced SWMM6 options;
 * - develop (`wasm6dev`) receives only finite-volume routing options.
 *
 * Returning a new object also prevents stale settings persisted for one
 * engine from leaking into a run with the other engine.
 */
export function swmm6OptionsForEngine(
  engine: EngineId,
  options: Swmm6Options,
): Swmm6Options | undefined {
  if (engine === "wasm6") {
    if (options.enabled !== true) return undefined;
    return {
      enabled: true,
      dynamicSlot: options.dynamicSlot,
      dpsCelerity: options.dpsCelerity,
      dpsAlpha: options.dpsAlpha,
      dpsDecayTime: options.dpsDecayTime,
      semiImplicit: options.semiImplicit,
      andersonAccel: options.andersonAccel,
      virtualJunctions: options.virtualJunctions,
      vjMomentum: options.vjMomentum,
    };
  }

  if (engine === "wasm6dev") {
    if (options.fvRouting !== true) return undefined;
    return {
      enabled: true,
      fvRouting: true,
      fvOrder: options.fvOrder,
      fvLimiter: options.fvLimiter,
      fvTimeIntegration: options.fvTimeIntegration,
      fvRiemann: options.fvRiemann,
      fvCellLength: options.fvCellLength,
      fvMinCells: options.fvMinCells,
      fvCfl: options.fvCfl,
    };
  }

  return undefined;
}