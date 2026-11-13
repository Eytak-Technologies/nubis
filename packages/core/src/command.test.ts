import { describe, expect, test } from "bun:test";
import { chatInput } from "./__fixtures__/interactions";
import { command, option } from "./index";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

describe("command", () => {
	test("keeps the definition and marks its kind", () => {
		const ping = command({
			description: "Replies with pong",
			run: ({ reply }) => reply("pong"),
		});

		expect(ping.kind).toBe("command");
		expect(ping.description).toBe("Replies with pong");
		expect(ping.options).toEqual({});
	});

	// Options are written inline on purpose: inline is where `required: true`
	// used to widen to `boolean` (see IsRequired in option.ts).
	test("infers option types from inline definitions", async () => {
		const replies: string[] = [];
		const ban = command({
			description: "Ban a member",
			options: {
				days: option.integer({ required: true }),
				reason: option.string({ description: "Why" }),
				loud: option.boolean(),
			},
			run: ({ options, reply }) => {
				assertType<
					Equal<
						typeof options,
						{
							days: number;
							reason: string | undefined;
							loud: boolean | undefined;
						}
					>
				>();
				return reply(`banned for ${options.days} days`);
			},
		});

		await ban.run({
			options: { days: 7, reason: undefined, loud: undefined },
			interaction: chatInput("ban"),
			reply: async (message) => {
				replies.push(typeof message === "string" ? message : "");
			},
		});

		expect(ban.options.days).toEqual({
			kind: "integer",
			required: true,
			description: undefined,
		});
		expect(replies).toEqual(["banned for 7 days"]);
	});
});
