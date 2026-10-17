import serverless from "serverless-http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const { app } = createApp(loadConfig());

/** AWS Lambda / Function URL entrypoint. The container path does not use this file. */
export const handler = serverless(app);
