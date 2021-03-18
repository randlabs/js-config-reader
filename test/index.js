const ConfigReader = require("../dist");
const test = require("ava");
const path = require("path");

// -----------------------------------------------------------------------------

test('Wellformed settings with schema', async (t) => {
	try {
		const settings = await ConfigReader.initialize({
			source: path.join(__dirname, "./json/settings_good.json"),
			schema: path.join(__dirname, "./schema/settings.schema.json")
		});
	}
	catch (err) {
		dumpValidationErrors(t, err);
		t.fail(err.toString());
		return;
	}
	t.pass();
});

test('Malformed settings with schema', async (t) => {
	try {
		const settings = await ConfigReader.initialize({
			source: path.join(__dirname, "./json/settings_bad.json"),
			schema: path.join(__dirname, "./schema/settings.schema.json")
		});
	}
	catch (err) {
		dumpValidationErrors(t, err);
		t.pass();
		return;
	}
	t.fail("Unexpected success.");
});

// -----------------------------------------------------------------------------

function dumpValidationErrors(t, err) {
	if (err instanceof ConfigReader.ValidationError) {
		if (err.failures.length > 0) {
			t.log("Validation errors:");
			for (const f of err.failures) {
				t.log("  " + f.location + ": " + f.message);
			}
		}
	}
}
