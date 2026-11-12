// Copied to src/internal-shim.js by the private mirror. No private ops code ships.
const missing = () => new Response("Not found", { status: 404 });
export const clientLog = missing;
export const opsRoute = missing;
export const viewAsGate = () => null;
export const viewAsToken = () => null;
export const opsResident = async () => ({ error: "not found" });
export const releasesPage = missing;
export const pushRelease = missing;
export const undoRelease = missing;
export const isReleaseAdmin = () => false;
export const kanbanProxy = missing;
export const parityRoute = missing;
