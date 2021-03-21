import Ajv from "ajv";
import avjDraft2019 from "ajv-formats-draft2019";
import fs from "fs";
import JSON5 from "json5";
import path from "path";
import { ClusterModule, loadCluster, Worker } from "./dynamicImport";

// -----------------------------------------------------------------------------

const GET_SETTINGS_REQUEST = "RANDLABS:JS:CONFIG:READER:getSettingsRequest";
const GET_SETTINGS_RESPONSE = "RANDLABS:JS:CONFIG:READER:getSettingsResponse";

// -----------------------------------------------------------------------------

export type DefaultSettings = Record<string, unknown>;

export type LoaderCallback = (source: string) => Promise<string>;

export type ExtendedValidatorCallback<S> = (settings: S) => Promise<void> | void;

export interface Options<S> {
	source?: string;
	envVar?: string;
	cmdLineParam?: string;
	loader?: LoaderCallback;
	schema?: string | Record<string, unknown>;
	schemaOpts?: Ajv.Options;
	extendedValidator?: ExtendedValidatorCallback<S>;
	usingClusters?: boolean;
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
let cluster: ClusterModule;

// -----------------------------------------------------------------------------

/**
 * Load configuration settings from the give source and, optionally, validate them.
 *
 * @param {Options} options - Initialization options including the settings' source. Can be a filename or url depending on the used loader.
 *                            Optional.
 * @param {string} options.source - Source location of the configuration settings. Optional.
 * @param {string} options.envVar - Environment variable name used to find the source. Optional.
 * @param {string} options.cmdLineParam - Command-line parameter to use to find the source. Optional.
 * @param {LoaderCallback} options.loader - Loader function used to load the configuration settings. Optional.
 * @param {string | Record<string, unknown>} options.schema - Schema location or JSON Schema object to validate configuration settings.
 *                                                            Optional.
 * @param {Ajv.Options} options.schemaOpts - Additional options to pass to the JSON Schema validator. Optional.
 * @param {ExtendedValidatorCallback} options.extendedValidator - Specifies an additional settings validator. Optional.
 * @param {boolean} options.usingClusters - Prepares usage for a cluster environment. Optional.
 * @returns {Settings} - Loaded configuration settings.
 */
export async function initialize<S = DefaultSettings>(options?: Options<S>): Promise<S> {
	let source: string | undefined;

	if (typeof options !== "undefined") {
		if (typeof options !== "object" || Array.isArray(options)) {
			throw new Error("Options not set");
		}
	}
	else {
		options = {};
	}

	if (options.usingClusters) {
		cluster = loadCluster();
	}

	if ((!cluster) || cluster.isMaster) {
		// Master or single instance

		// If a source was passed, use it
		if (typeof options.source === "string") {
			source = options.source;
		}

		// If no source, try to get source from environment variable
		if (!source && typeof options.envVar === "string") {
			if (typeof process.env[options.envVar] === "string") {
				source = process.env[options.envVar];
			}
		}

		// If still no source, parse command-line arguments
		if (!source) {
			let cmdLineOption = "settings";

			if (typeof options.cmdLineParam === "string" && options.cmdLineParam.length > 0) {
				cmdLineOption = options.cmdLineParam;
			}

			cmdLineOption = "--" + cmdLineOption;

			// Lookup the command-line parameter
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

		// If we reach here and no source, throw error
		if (!source) {
			throw new Error("Source not defined");
		}

		// Check for loader, if none provided, read from disk file
		try {
			if (!options.loader) {
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
			else {
				const contents = await options.loader(source);
				settings = JSON5.parse(contents);
			}
		}
		catch (err) {
			throw new Error("Unable to load configuration [" + err.message + "].");
		}

		// Validate settings against a schema if one is provided
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

			// Create schema validator
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
			avjDraft2019(ajv);
			const validate = ajv.compile(schema);

			// Validate settings
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

		settingsSource = source;

		// Run extended validator if provided
		if (options.extendedValidator) {
			await options.extendedValidator(settings as S);
		}

		// After loading the settings, if running in a cluster, set up the message listener
		if (cluster) {
			cluster.on("message", (worker: Worker, message: any): void => {
				if (worker && message.type === GET_SETTINGS_REQUEST) {
					// If the worker exits abruptly, it may still be in the workers list but not able to communicate.
					if (worker.isConnected()) {
						worker.send({
							type: GET_SETTINGS_RESPONSE,
							settings,
							settingsSource
						});
					}
				}
			});
		}
	}
	else {
		// Worker-side, ask the master for the settings
		await new Promise<void>((resolve, reject) => {
			let timer: NodeJS.Timer | null = null;
			let fulfilled = false;

			//setup a message listener that processes the response from the master
			function msgListener(message: any): void {
				if (message.type === GET_SETTINGS_RESPONSE) {
					settings = message.settings as S;
					settingsSource = message.settingsSource as string;

					fulfill();
				}
			}
			process.on("message", msgListener);

			function fulfill(err?: Error) {
				if (!fulfilled) {
					fulfilled = true;

					process.off("message", msgListener);

					if (timer) {
						clearTimeout(timer);
						timer = null;
					}

					if (!err) {
						resolve();
					}
					else {
						reject(err);
					}
				}
			}

			// Setup a timer if, for some reason, we don't get a response in time
			timer = setTimeout(() => {
				fulfill(new Error("Operation timed out"));
			}, 2000);

			// Send the request to the master process
			process.send!({
				type: GET_SETTINGS_REQUEST
			});
		});
	}

	// Done
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
