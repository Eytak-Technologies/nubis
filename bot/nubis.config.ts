import { defineConfig } from "nubis";

// Settings for the whole bot. Every key is optional; see https://eytak.com/nubis/docs/configuration
export default defineConfig({
	presence: { activity: { type: "watching", name: "for /ping" } },
});
