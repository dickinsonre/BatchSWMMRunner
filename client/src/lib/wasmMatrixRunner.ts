import type { MatrixVariant } from "@shared/inpOptions";

export interface WasmMatrixBaseFile {
  id: string;
  name: string;
  file: File;
}

export interface WasmMatrixVariantRun {
  index: number;
  variant: MatrixVariant;
  id: string;
  name: string;
  file: File;
}

export type WasmMatrixCancel = (() => void) & { skip: (fileId: string) => void };

interface RunWasmMatrixOptions {
  variants: MatrixVariant[];
  baseFile: WasmMatrixBaseFile;
  cancelRef: { current: boolean };
  /**
   * Exposes a cancellation function for the currently active variant. The
   * caller owns its lifetime (for example, by storing it in a React ref).
   */
  setActiveCancel: (cancel: WasmMatrixCancel | null) => void;
  /**
   * Starts one solver variant. It must call `onComplete` only for normal
   * completion and return a function that immediately stops that variant.
   */
  startVariant: (run: WasmMatrixVariantRun, onComplete: () => void) => WasmMatrixCancel;
  /** Called once only when every variant completes normally. */
  onComplete: () => void;
}

/**
 * Runs matrix variants in order, stopping immediately when cancelled.
 *
 * A cancelled WASM batch deliberately does not call its normal completion
 * callback. The wrapped active cancel therefore also settles the pending
 * variant, allowing this coordinator to observe cancellation and avoid
 * dispatching another solver variant.
 */
export async function runWasmMatrix({
  variants,
  baseFile,
  cancelRef,
  setActiveCancel,
  startVariant,
  onComplete,
}: RunWasmMatrixOptions): Promise<boolean> {
  const baseName = baseFile.name.replace(/\.inp$/i, "");

  for (let index = 0; index < variants.length; index++) {
    if (cancelRef.current) break;

    const variant = variants[index];
    const run: WasmMatrixVariantRun = {
      index,
      variant,
      id: `${baseFile.id}-v${index}`,
      name: `${baseName} [${variant.label}].inp`,
      file: baseFile.file,
    };

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      let stopBatch: WasmMatrixCancel = Object.assign(() => {}, { skip: (_fileId: string) => {} });
      const cancelActiveVariant = () => {
        stopBatch();
        done();
      };
      const activeCancel = Object.assign(cancelActiveVariant, {
        skip: (fileId: string) => stopBatch.skip(fileId),
      });

      setActiveCancel(activeCancel);
      stopBatch = startVariant(run, done);
    });

    setActiveCancel(null);
  }

  setActiveCancel(null);
  const completed = !cancelRef.current;
  if (completed) onComplete();
  return completed;
}