import { event } from "@nubisjs/core";

export const joined: string[] = [];

export default [
	event("guildMemberAdd", (member) => {
		joined.push(member.user.id);
	}),
	event("guildMemberRemove", (data) => {
		joined.splice(joined.indexOf(data.user.id), 1);
	}),
];
