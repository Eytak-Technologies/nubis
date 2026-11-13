import { event } from "nubis";

export default event("ready", (data) => {
	console.log(`Logged in as ${data.user.username}`);
});
