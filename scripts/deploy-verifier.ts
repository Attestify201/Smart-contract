import "dotenv/config";
import process from "node:process";
import { readFileSync } from "fs";
import { join } from "path";
import { encodeAbiParameters, encodeFunctionData } from "viem";

import { network } from "hardhat";
import type { Address } from "viem";

// Self protocol integration removed. Add your new verifier deployment logic here if needed.