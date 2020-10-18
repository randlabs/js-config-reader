/* eslint-disable global-require */
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import ts from "@wessberg/rollup-plugin-ts";
import json from "@rollup/plugin-json";
import { terser } from 'rollup-plugin-terser';
import pkg from './package.json';

export default [
	{
		input: './src/index.ts',
		output: {
			file: pkg.main,
			format: 'cjs',
			sourcemap: true,
			exports: "auto"
		},
		external: [ "fs", "path", "util", "ajv", "ajv-formats-draft2019", "json5" ],
		plugins: [
			json(),
			ts({
				tsconfig: "./tsconfig.json"
			}),
			commonjs(),
			resolve(),
			terser({
				ecma: 2015
			})
		]
	}
];
