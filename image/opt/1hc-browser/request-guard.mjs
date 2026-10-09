// Only the channel controller may drive Chrome or open the VNC bridge. A page in
// Chrome can reach loopback and can open a WebSocket, so the lack of public
// container ingress does not protect these local endpoints.
export function controllerRequest(headers) {
  return headers["x-1helm-controller"] === "1" &&
    !Object.hasOwn(headers, "origin") &&
    !Object.keys(headers).some((key) => key.startsWith("sec-fetch-"));
}
