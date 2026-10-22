import { createApp } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";
const { app } = createApp(loadConfig());
export default app;
