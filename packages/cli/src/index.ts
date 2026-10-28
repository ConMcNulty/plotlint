#!/usr/bin/env node

import { exitQuietlyOnEpipe } from "./epipe.js";
import { runProgram } from "./program.js";

exitQuietlyOnEpipe(process.stdout);
exitQuietlyOnEpipe(process.stderr);
await runProgram();
