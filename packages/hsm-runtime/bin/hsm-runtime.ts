#!/usr/bin/env bun
/**
 * saos-hsm-runtime — production signing runtime entry point.
 *
 *   bun packages/hsm-runtime/bin/hsm-runtime.ts --once
 *   bun packages/hsm-runtime/bin/hsm-runtime.ts --serve
 */

import { main } from "../src/cli";

main().then((code) => {
  process.exitCode = code;
});
