import Ajv from "ajv";
import fs from "fs";
import JSON5 from "json5";
import path from "path";

// -----------------------------------------------------------------------------

export type DefaultSettings = Record<string, unknown>;

export type LoaderCallback<S> = (source: string) => Promise<S>;

export type ExtendedValidatorCallback<S> = (settings: S) => Promise<void> | void;

export interface Options<S> {
	source?: string;
	envVar?: string;
	cmdLineParam?: string;
	loader?: LoaderCallback<S>;
	schema?: string | Record<string, unknown>;
	schemaOpts?: Ajv.Options;
	extendedValidator?: ExtendedValidatorCallback<S>;
}

export interface FailedConstraint {
	location: string;
	message: string;
}

export class ValidationError extends Error {
	public failures: FailedConstraint[];

	constructor(message: string) {
		super(message);
		this.name = 'ValidationError';
		this.failures = [];
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

// -----------------------------------------------------------------------------

let settings: any;
let settingsSource: string;

// -----------------------------------------------------------------------------

/**
 * Load configuration settings from the give source and, optionally, validate them.
 *
 * @param {Options} options - Initialization options including the settings' source. Can be a filename or url depending on the used loader.
 * @param {string} options.source - Source location of the configuration settings.
 * @param {string} options.envVar - Environment variable name used to find the source. Optional.
 * @param {string} options.cmdLineParam - Command-line parameter to use to find the source. Optional.
 * @param {LoaderCallback} options.loader - Loader function used to load the configuration settings. Optional.
 * @param {string | Record<string, unknown>} options.schema - Schema location or JSON Schema object to validate configuration settings.
 *                                                            Optional.
 * @param {Ajv.Options} options.schemaOpts - Additional options to pass to the JSON Schema validator. Optional.
 * @param {ExtendedValidatorCallback} options.extendedValidator - Specifies an additional settings validator. Optional.
 *
 * @returns {Settings} - Loaded configuration settings.
 */
export async function initialize<S = DefaultSettings>(options: Options<S>): Promise<S> {
	let source: string | undefined;

	if (!options) {
		throw new Error("Options not set");
	}

	// if a source was passed, use it
	if (typeof options.source === "string") {
		source = options.source;
	}

	// if no source, try to get source from environment variable
	if (!source && typeof options.envVar === "string") {
		if (typeof process.env[options.envVar] === "string") {
			source = process.env[options.envVar];
		}
	}

	// if still no source, parse command-line arguments
	if (!source) {
		let cmdLineOption = "settings";

		if (typeof options.cmdLineParam === "string" && options.cmdLineParam.length > 0) {
			cmdLineOption = options.cmdLineParam;
		}

		cmdLineOption = "--" + cmdLineOption;

		//lookup the command-line parameter
		for (let idx = 0; idx < process.argv.length; idx++) {
			if (process.argv[idx] === cmdLineOption) {
				if (idx + 1 >= process.argv.length) {
					throw new Error("Missing source in '" + cmdLineOption + "' parameter.");
				}
				source = process.argv[idx + 1];
				break;
			}
		}
	}

	// if we reach here and no source, throw error
	if (!source) {
		throw new Error("Source not defined");
	}

	// check for loader, if none provided, read from disk file
	if (!options.loader) {
		try {
			source = path.resolve(process.cwd(), source);

			// eslint-disable-next-line global-require
			if (source.endsWith(".js")) {
				// eslint-disable-next-line global-require
				settings = require(source);
			}
			else {
				const contents: Buffer = fs.readFileSync(source);
				settings = JSON5.parse(contents.toString());
			}
		}
		catch (err) {
			throw new Error("Unable to load configuration.");
		}
	}
	else {
		settings = await options.loader(source);
	}

	// validate settings against a schema if one is provided
	if (options.schema) {
		let schema: Record<string, unknown>;

		if (typeof options.schema === "string") {
			try {
				const filename = path.resolve(process.cwd(), options.schema);

				const contents: Buffer = fs.readFileSync(filename);
				schema = JSON5.parse(contents.toString());
			}
			catch (err) {
				throw new Error("Unable to load schema.");
			}
		}
		else if (typeof options.schema === "object") {
			schema = options.schema;
		}
		else {
			throw new Error("Invalid validator schema.");
		}

		// create schema validator
		const schemaOpts = (typeof options.schemaOpts === "object") ? options.schemaOpts : {};
		const ajv = new Ajv({
			...schemaOpts,
			...{
				allErrors: true,
				messages: true,
				useDefaults: true,
				format: "full"
			}
		});
		const validate = ajv.compile(schema);

		//validate settings
		if (!validate(settings)) {
			const err = new ValidationError("Validation failed.");

			if (validate.errors) {
				for (const e of validate.errors) {
					err.failures.push({
						location: e.schemaPath,
						message: e.message || ""
					});
				}
			}
			throw err;
		}
	}

	if (options.extendedValidator) {
		await options.extendedValidator(settings as S);
	}

	settingsSource = source;

	//done
	return settings as S;
}

/**
 * Retrieves the loaded configuration settings.
 *
 * @returns {Settings} - Loaded configuration settings.
 */
export function get<S = DefaultSettings>(): S {
	return settings as S;
}

/**
 * Retrieves the source of the loaded configuration settings.
 *
 * @returns {string} - The source of settings.
 */
export function getSource(): string {
	return settingsSource;
}
