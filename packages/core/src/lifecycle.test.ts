import { describe, expect, test } from "bun:test";
import {
	ComponentType,
	InteractionResponseType as R,
} from "discord-api-types/v10";
import {
	chatInput,
	componentInteraction,
	manualClock,
	recorder,
} from "./__fixtures__/interactions";
import {
	buildCommandTree,
	button,
	command,
	createComponentRegistry,
	createLifecycle,
	DEFAULT_AUTO_DEFER_MS,
	dispatch,
	dispatchComponent,
	ERROR_MESSAGE,
	modal,
	NubisError,
	type Transport,
	textInput,
} from "./index";

const setup = (
	kind: "command" | "component" | "modal",
	ephemeral?: boolean,
) => {
	const rec = recorder();
	const clock = manualClock();
	const lifecycle = createLifecycle(rec.transport, {
		kind,
		ephemeral,
		schedule: clock.schedule,
	});
	return { ...rec, clock, lifecycle };
};

const form = modal({
	id: "form",
	title: "Form",
	fields: { a: textInput({ label: "A" }) },
	onSubmit: () => {},
});

describe("replies", () => {
	test("the first reply answers, later ones follow up", async () => {
		const { lifecycle, trace, replies } = setup("command");
		await lifecycle.reply("one");
		await lifecycle.reply("two");
		expect(trace).toEqual([
			`respond:${R.ChannelMessageWithSource}`,
			"followUp",
		]);
		expect(replies).toEqual(["one", "two"]);
	});

	test("editReply edits the first reply and needs one", async () => {
		const { lifecycle, trace } = setup("command");
		await expect(lifecycle.editReply("too early")).rejects.toThrow(NubisError);
		await lifecycle.reply("50%");
		await lifecycle.editReply("100%");
		expect(trace).toEqual([
			`respond:${R.ChannelMessageWithSource}`,
			"editOriginal",
		]);
	});

	test("only mentioned users can be pinged unless a reply says otherwise", async () => {
		const { lifecycle, calls } = setup("command");
		await lifecycle.reply("@everyone hi");
		await lifecycle.reply({ content: "@here", allowedMentions: { parse: [] } });
		expect(calls[0]).toMatchObject({
			response: { data: { allowed_mentions: { parse: ["users"] } } },
		});
		expect(calls[1]).toMatchObject({
			body: { allowed_mentions: { parse: [] } },
		});
	});
});

describe("auto-defer", () => {
	test("shows thinking… after two seconds, then the reply replaces it", async () => {
		const { lifecycle, clock, trace } = setup("command");
		expect(clock.scheduledMs).toEqual([DEFAULT_AUTO_DEFER_MS]);
		clock.fire();
		await lifecycle.reply("done");
		expect(trace).toEqual([
			`respond:${R.DeferredChannelMessageWithSource}`,
			"editOriginal",
		]);
	});

	test("an early reply cancels it", async () => {
		const { lifecycle, clock, trace } = setup("command");
		await lifecycle.reply("fast");
		clock.fire();
		await lifecycle.finish();
		expect(trace).toEqual([`respond:${R.ChannelMessageWithSource}`]);
	});

	test("uses the command's ephemeral setting", async () => {
		const { lifecycle, clock, calls } = setup("command", true);
		clock.fire();
		await lifecycle.reply("secret");
		expect(calls[0]).toEqual({
			type: "respond",
			response: {
				type: R.DeferredChannelMessageWithSource,
				data: { flags: 64 },
			},
		});
		expect(calls[1]).toMatchObject({
			type: "editOriginal",
			body: { flags: 64 },
		});
	});

	test("a reply with different visibility swaps thinking… for a follow-up", async () => {
		const { lifecycle, clock, trace, calls } = setup("command");
		clock.fire();
		await lifecycle.reply({ content: "only you", ephemeral: true });
		expect(trace).toEqual([
			`respond:${R.DeferredChannelMessageWithSource}`,
			"deleteOriginal",
			"followUp",
		]);
		expect(calls[2]).toMatchObject({
			body: { content: "only you", flags: 64 },
		});
	});

	test("components are acknowledged silently, and update() still edits", async () => {
		const { lifecycle, clock, trace } = setup("component");
		clock.fire();
		await lifecycle.update("edited");
		expect(trace).toEqual([
			`respond:${R.DeferredMessageUpdate}`,
			"editOriginal",
		]);
	});

	test("the timer and a reply in flight can't both answer", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const rec = recorder();
		const slow: Transport = {
			...rec.transport,
			respond: async (response) => {
				await gate;
				await rec.transport.respond(response);
			},
		};
		const clock = manualClock();
		const lifecycle = createLifecycle(slow, {
			kind: "command",
			schedule: clock.schedule,
		});

		const replying = lifecycle.reply("hi"); // not awaited: still sending
		clock.fire(); // the timer goes off meanwhile
		release();
		await replying;
		await lifecycle.finish();

		expect(rec.trace).toEqual([`respond:${R.ChannelMessageWithSource}`]);
	});

	test("can be turned off", async () => {
		const rec = recorder();
		const clock = manualClock();
		createLifecycle(rec.transport, {
			kind: "command",
			autoDeferMs: false,
			schedule: clock.schedule,
		});
		expect(clock.scheduledMs).toEqual([]);
	});
});

describe("components", () => {
	test("update() first edits the message in place", async () => {
		const { lifecycle, trace } = setup("component");
		await lifecycle.update("one");
		await lifecycle.update("two");
		await lifecycle.reply("new message");
		expect(trace).toEqual([
			`respond:${R.UpdateMessage}`,
			"editOriginal",
			"followUp",
		]);
	});

	test("update() after reply() is an error, not a wrong edit", async () => {
		const { lifecycle } = setup("component");
		await lifecycle.reply("reply");
		await expect(lifecycle.update("edit")).rejects.toThrow(
			/must come before reply\(\)/,
		);
	});

	test("editReply() after deferUpdate() edits the component's message", async () => {
		const { lifecycle, trace } = setup("component");
		await lifecycle.deferUpdate();
		await lifecycle.editReply("done");
		await lifecycle.editReply("done again");
		expect(trace).toEqual([
			`respond:${R.DeferredMessageUpdate}`,
			"editOriginal",
			"editOriginal",
		]);
	});

	test("editReply() works after a slow click was auto-deferred", async () => {
		const { lifecycle, trace, clock } = setup("component");
		clock.fire();
		await lifecycle.editReply("finally");
		expect(trace).toEqual([
			`respond:${R.DeferredMessageUpdate}`,
			"editOriginal",
		]);
	});

	test("editReply() with nothing to edit says what's missing", async () => {
		const { lifecycle } = setup("component");
		await expect(lifecycle.editReply("x")).rejects.toThrow(
			/reply, defer\(\) or deferUpdate\(\)/,
		);
	});

	test("commands have no update() or deferUpdate()", async () => {
		const { lifecycle } = setup("command");
		await expect(lifecycle.update("x")).rejects.toThrow(NubisError);
		await expect(lifecycle.deferUpdate()).rejects.toThrow(NubisError);
	});
});

describe("defer and showModal", () => {
	test("defer() is a no-op once answered", async () => {
		const { lifecycle, trace } = setup("command");
		await lifecycle.defer({ ephemeral: true });
		await lifecycle.defer();
		await lifecycle.reply({ content: "x", ephemeral: true });
		await lifecycle.defer();
		expect(trace).toEqual([
			`respond:${R.DeferredChannelMessageWithSource}`,
			"editOriginal",
		]);
	});

	test("showModal() must be first, and nothing follows it", async () => {
		const first = setup("command");
		await first.lifecycle.showModal(form());
		expect(first.trace).toEqual([`respond:${R.Modal}`]);
		await expect(first.lifecycle.reply("x")).rejects.toThrow(
			/answered with a modal/,
		);

		const late = setup("command");
		late.clock.fire();
		await expect(late.lifecycle.showModal(form())).rejects.toThrow(
			/must be the first response/,
		);
	});

	test("a modal submission can't open another modal", async () => {
		const { lifecycle } = setup("modal");
		await expect(lifecycle.showModal(form())).rejects.toThrow(
			/can't open another modal/,
		);
	});
});

describe("dispatch", () => {
	test("a throwing command tells the user, even after thinking…", async () => {
		const clock = manualClock();
		const boom = command({
			description: "Boom",
			run: async ({ defer }) => {
				await defer();
				throw new Error("database down");
			},
		});
		const { trace, replies, transport } = recorder();
		const result = await dispatch(
			buildCommandTree([{ path: ["boom"], definition: boom }]),
			chatInput("boom"),
			transport,
			{ schedule: clock.schedule },
		);

		expect(result.status).toBe("error");
		expect(trace).toEqual([
			`respond:${R.DeferredChannelMessageWithSource}`,
			"deleteOriginal",
			"followUp",
		]);
		expect(replies).toEqual([ERROR_MESSAGE]);
	});

	test("a command that never answers is reported", async () => {
		const silent = command({ description: "Silent", run: () => {} });
		const { transport } = recorder();
		const result = await dispatch(
			buildCommandTree([{ path: ["silent"], definition: silent }]),
			chatInput("silent"),
			transport,
			{ autoDeferMs: false },
		);
		expect(result).toEqual({
			status: "handled",
			path: ["silent"],
			responded: false,
		});
	});

	test("a click whose handler doesn't answer is acknowledged", async () => {
		const quiet = button({ id: "quiet", label: "Quiet", onClick: () => {} });
		const { trace, transport } = recorder();
		const result = await dispatchComponent(
			createComponentRegistry([quiet]),
			componentInteraction("quiet", { type: ComponentType.Button }),
			transport,
			{ autoDeferMs: false },
		);
		expect(result).toEqual({ status: "handled", id: "quiet", responded: true });
		expect(trace).toEqual([`respond:${R.DeferredMessageUpdate}`]);
	});

	test("unknown commands get an answer", async () => {
		const { replies, transport } = recorder();
		await dispatch(buildCommandTree([]), chatInput("gone"), transport, {
			autoDeferMs: false,
		});
		expect(replies[0]).toMatch(/isn't available anymore/);
	});
});
