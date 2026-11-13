import { button, stateOf } from "nubis";

// The count travels in the button's custom_id, so no database is needed.
// For state you act on (user ids, amounts), use a schema such as Zod instead
// of stateOf: anyone can craft a custom_id, and schemas validate every click.
export const counter = button({
	id: "counter",
	label: "Click me",
	style: "primary",
	state: stateOf<{ count: number }>(),
	onClick: ({ state, update }) => {
		const count = state.count + 1;
		return update({
			content: `Clicked ${count} times`,
			components: [counter({ count })],
		});
	},
});
