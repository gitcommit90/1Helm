import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { configureNetworkDefaults } = require("@gitcommit90/rerouted/src/lib/network.js") as { configureNetworkDefaults: () => unknown };
const constants = require("@gitcommit90/rerouted/src/lib/constants.js") as { REQUEST_TIMEOUT_MS: number };

configureNetworkDefaults();
constants.REQUEST_TIMEOUT_MS = 180_000;
