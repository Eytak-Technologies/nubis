#!/usr/bin/env node
import { runCli } from "./run-cli";

const { code, output } = runCli(process.argv.slice(2));
(code === 0 ? console.log : console.error)(output);
process.exitCode = code;
