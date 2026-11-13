import { defineConfig } from "../../../packages/nubis/dist/index.js";

export default defineConfig({
	presence: { activity: { type: "watching", name: "the smoke test" } },
});
