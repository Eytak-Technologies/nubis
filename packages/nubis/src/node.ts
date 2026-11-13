/**
 * Node and Bun only: reading a bot from disk. Kept out of the main `nubis`
 * entry so code that imports `nubis` can still be bundled for edge runtimes.
 */
export type { LoadOptions, Project } from "./loader";
export { loadProject } from "./loader";
export { toNodeListener } from "./node-listener";
