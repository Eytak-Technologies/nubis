import { folder, guildOnly } from "@nubisjs/core";

export default folder({
	description: "Server admin tools",
	guards: [guildOnly],
});
