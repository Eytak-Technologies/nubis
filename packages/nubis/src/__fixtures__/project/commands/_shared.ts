import { option } from "@nubisjs/core";

// Starts with "_": a helper, not a command, so the loader skips it.
export const reason = option.string({ description: "Why" });
