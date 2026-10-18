// Match the Apps card's Soon state without hiding built-ins or existing connections.
// Which apps are hidden is not decided here: the Worker leaves them out of the catalog it serves (proto src/app-visibility.js).
export const appIsSoon = (app: { x?: number; b?: number }, live: boolean, connected: boolean) =>
  live && !!app.x && !app.b && !connected;
