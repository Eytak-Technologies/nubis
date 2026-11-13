import { describe, expect, test } from "vitest";
import { fake, testCommand, testComponent } from "nubis/testing";
import { counter } from "../components/counter.ts";
import echo from "../commands/echo.ts";
import ping from "../commands/ping.ts";

describe("commands", () => {
	test("/ping answers", async () => {
		const result = await testCommand(ping).run();
		expect(result.replies).toEqual(["Pong!"]);
	});

	test("/echo repeats privately", async () => {
		const result = await testCommand(echo)
			.as({ user: fake.user("alice") })
			.run({ text: "hello" });
		expect(result.replies).toEqual(["hello"]);
		expect(result.ephemeral).toBe(true);
	});

	test("the counter counts", async () => {
		const result = await testComponent(counter).click({ count: 41 });
		expect(result.replies).toEqual(["Clicked 42 times"]);
	});
});
