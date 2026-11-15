// Loaded only when a reply holds math (chat-math.ts fetches it as v3/math.js), so Temml stays out of app.js.
import temml from "temml";
export default (tex: string, displayMode: boolean) => temml.renderToString(tex, { displayMode, throwOnError: true });
