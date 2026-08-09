import pkg from "../../../package.json";

/**
 * Single source of truth for the app version shown in the UI.
 * Bump "version" in package.json when releasing — every footer updates automatically.
 */
export const APP_VERSION: string = pkg.version;
