import { Locale } from "discord-api-types/v10";
import { NubisError } from "./errors";
import { assertValidDescription, assertValidName } from "./names";

/** One of Discord's locales, as a string: "tr", "en-US", "pt-BR"… */
export type DiscordLocale = `${Locale}`;

/** Text in other languages, by Discord locale: `{ tr: "Bir zar at", de: "Würfle" }`. */
export type Localizations = Readonly<Partial<Record<DiscordLocale, string>>>;

/**
 * What Discord's command picker shows in other languages. Discord picks the
 * entry for the user's client language, and the plain `name`/`description`
 * everywhere else.
 */
export interface Localizable {
	/**
	 * The name in other languages. Follows the same rules as the name:
	 * 1-32 lowercase letters, digits, "-" or "_".
	 */
	readonly nameLocalizations?: Localizations;
	/** The description in other languages, 1-100 characters each. */
	readonly descriptionLocalizations?: Localizations;
}

const LOCALES: ReadonlySet<string> = new Set(Object.values(Locale));

function checkLocales(map: Localizations, where: string): void {
	for (const locale of Object.keys(map)) {
		if (!LOCALES.has(locale)) {
			throw new NubisError(
				`${where}: "${locale}" isn't a Discord locale. Use codes like "tr", "de", "en-US" or "pt-BR".`,
			);
		}
	}
}

const entries = (map: Localizations) =>
	Object.entries(map) as [DiscordLocale, string][];

/** `name_localizations` for a slash command, option or folder, checked. */
export function nameLocalizations(
	map: Localizations | undefined,
	where: string,
): { name_localizations?: Localizations } {
	if (!map) return {};
	checkLocales(map, where);
	for (const [locale, name] of entries(map)) {
		assertValidName(name, `${where} (${locale})`);
	}
	return { name_localizations: map };
}

/** `description_localizations`, checked. */
export function descriptionLocalizations(
	map: Localizations | undefined,
	where: string,
): { description_localizations?: Localizations } {
	if (!map) return {};
	checkLocales(map, where);
	for (const [locale, description] of entries(map)) {
		assertValidDescription(description, `${where} (${locale})`);
	}
	return { description_localizations: map };
}

/**
 * `name_localizations` for something whose name is free text: a choice
 * (1-100 characters) or a context menu command (1-32).
 */
export function labelLocalizations(
	map: Localizations | undefined,
	where: string,
	max: number,
): { name_localizations?: Localizations } {
	if (!map) return {};
	checkLocales(map, where);
	for (const [locale, label] of entries(map)) {
		if (label.trim().length === 0 || label.length > max) {
			throw new NubisError(
				`${where} (${locale}): must be 1-${max} characters and not blank (got ${label.length}).`,
			);
		}
	}
	return { name_localizations: map };
}
