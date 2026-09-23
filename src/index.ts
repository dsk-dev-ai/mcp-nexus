#!/usr/bin/env node
import { run } from "./cli.ts";

const code = await run(process.argv.slice(2));
process.exitCode = code;