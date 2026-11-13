import { userCommand } from "@nubisjs/core";

export default userCommand({
	name: "View profile",
	run: ({ target, reply }) => reply(target.username),
});
