import { command } from "nubis";
import { counter } from "../components/counter.ts";

export default command({
	description: "A button that counts clicks",
	run: ({ reply }) =>
		reply({ content: "Clicked 0 times", components: [counter({ count: 0 })] }),
});
