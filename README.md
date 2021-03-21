# js-config-reader

Config Reader is a module to ease configuration settings load and validation with the help of JSON schemas.

## Installation

```shell
npm install --save @randlabs/js-config-reader
```

## Usage

```javascript
const ConfigReader = require("@randlabs/js-config-reader");

const settings = await ConfigReader.initialize(options);
```

### Example
```javascript
const ConfigReader = require("@randlabs/js-config-reader");
 
const settings = await ConfigReader.initialize({
    source: path.join(__dirname, "./settings.json"),
    schema: path.join(__dirname, "./settings.schema.json")
});
```

The `options` parameter is an object with the following fields:

* `source` - Source location of the configuration settings. Can be a filename or url depending on the used loader. Optional.
* `envVar` - Environment variable name used to find the source. Optional.
  I.e.: Define `export MY_SETTINGS=/home/myuser/settings.json` and set `MY_SETTINGS` as the `envVar`.
* `cmdLineParam` - Command-line parameter to use to find the source. Optional.
  I.e.: If `settings` is specified, then the code will look for the `--settings` command-line parameter.
* `loader` - Loader function used to load the configuration settings. Optional.
* `schema` - Schema location or JSON Schema object to validate configuration settings. Optional.
* `schemaOpts` - Additional options to pass to the JSON Schema validator. Optional.
* `extendedValidator` - Specifies an additional settings validator. Optional.
* `usingClusters` - Prepares usage for a cluster environment. Optional.
 
# License

Apache 2.0
