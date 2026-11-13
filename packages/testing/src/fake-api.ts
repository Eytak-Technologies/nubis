import type { NubisApi } from "@nubisjs/core";

export interface ApiCall {
	/** "channels.createMessage", "guilds.banUser", … */
	readonly method: string;
	readonly args: readonly unknown[];
}

export type FakeApi = NubisApi & {
	/** Every call, in order. */
	readonly calls: ApiCall[];
	/** The calls to one method. */
	callsTo(method: string): ApiCall[];
};

/**
 * An `api` that records calls instead of making them. Pass it with
 * `.with({ api })`; methods resolve to `{}` unless `responses` says otherwise:
 *
 *     const api = fakeApi({ "guilds.get": { id: "g1", name: "Test" } });
 *     await testCommand(ban).with({ api }).run({ user });
 *     expect(api.callsTo("guilds.banUser")).toHaveLength(1);
 */
export function fakeApi(
	responses: Readonly<
		Record<string, unknown | ((...args: unknown[]) => unknown)>
	> = {},
): FakeApi {
	const calls: ApiCall[] = [];
	const namespaces = new Map<string, unknown>();

	const namespace = (name: string) =>
		new Proxy(
			{},
			{
				get(_target, key) {
					if (typeof key === "symbol" || key === "then") return undefined;
					const method = `${name}.${key}`;
					return async (...args: unknown[]) => {
						calls.push({ method, args });
						const response = responses[method];
						return typeof response === "function"
							? (response as (...a: unknown[]) => unknown)(...args)
							: (response ?? {});
					};
				},
			},
		);

	return new Proxy(
		{},
		{
			get(_target, key) {
				if (key === "calls") return calls;
				if (key === "callsTo") {
					return (method: string) =>
						calls.filter((call) => call.method === method);
				}
				if (typeof key === "symbol" || key === "then") return undefined;
				if (!namespaces.has(key)) namespaces.set(key, namespace(key));
				return namespaces.get(key);
			},
		},
	) as FakeApi;
}
