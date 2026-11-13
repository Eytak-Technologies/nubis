import { button, modal, stateOf, textInput } from "@nubisjs/core";

export const reportForm = modal({
	id: "report-form",
	title: "Report",
	fields: { details: textInput({ label: "Details", required: true }) },
	onSubmit: ({ values, reply }) => reply(`Thanks: ${values.details}`),
});

export const openReport = button({
	id: "open-report",
	label: "Report",
	state: stateOf<{ messageId: string }>(),
	onClick: ({ showModal }) => showModal(reportForm()),
});

// Exported twice on purpose: the loader must register it once.
export default openReport;
