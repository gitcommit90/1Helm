import assert from "node:assert/strict";
import test from "node:test";
import target from "../desktop/workspace-target.cjs";

test("desktop navigation stays within the selected service", () => {
  const { allowedRemoteUrl } = target;
  assert.equal(allowedRemoteUrl("https://app.1helm.com/onboard"), false);
  assert.equal(allowedRemoteUrl("https://app.1helm.com/onboard", "https://app.1helm.com"), true);
  assert.equal(allowedRemoteUrl("https://owner.1helm.com/auth/handoff?token=abc", "https://app.1helm.com"), true);
  assert.equal(allowedRemoteUrl("https://owner.1helm.com.evil.example/", "https://app.1helm.com"), false);
  assert.equal(allowedRemoteUrl("https://owner.1helm.com/", "https://private.example"), false);
  assert.equal(allowedRemoteUrl("https://private.example/app", "https://private.example"), true);
  assert.equal(allowedRemoteUrl("http://private.example/app", "https://private.example"), false);
  assert.equal(target.allowedPermissionUrl("https://owner.1helm.com/w/owner/app#/main", "https://owner.1helm.com"), true);
  assert.equal(target.allowedPermissionUrl("https://other.1helm.com/w/other/app", "https://owner.1helm.com"), false);
  assert.equal(target.allowedPermissionUrl("https://owner.1helm.com/w/other/app", "https://owner.1helm.com"), false);
  assert.equal(target.allowedPermissionUrl("https://owner.1helm.com/p/unsafe/", "https://owner.1helm.com"), false);
  assert.equal(target.allowedPermissionUrl("https://private.example/w/owner/app", "https://private.example"), true);
  assert.equal(target.allowedPermissionUrl("https://private.example/s/owner/p/unsafe/", "https://private.example"), false);
  assert.equal(target.hostedWorkspaceLandingOrigin("https://owner.1helm.com/w/owner/app#/main", "https://app.1helm.com"), "https://owner.1helm.com");
  assert.equal(target.hostedWorkspaceLandingOrigin("https://owner.1helm.com/auth/handoff?token=secret", "https://app.1helm.com"), "");
  assert.equal(target.hostedWorkspaceLandingOrigin("https://owner.1helm.com/p/unsafe/", "https://app.1helm.com"), "");
  assert.equal(target.hostedWorkspaceLandingOrigin("https://owner.1helm.com/w/other/app", "https://app.1helm.com"), "");
  assert.equal(target.hostedWorkspaceLandingOrigin("https://other.1helm.com/w/other/app", "https://owner.1helm.com"), "");
  assert.equal(target.hostedWorkspaceLandingOrigin("https://owner.1helm.com/w/owner/app", "https://private.example"), "");
});

test("meeting sound is granted only to the selected app page's top frame, and only when sound is asked for", () => {
  const { allowedDisplayMediaRequest: ok } = target;
  const sel = "https://owner.1helm.com";
  const req = (over = {}) => ({ frame: { url: "https://owner.1helm.com/w/owner/app#/main", parent: null }, securityOrigin: sel, audioRequested: true, videoRequested: true, ...over });
  assert.equal(ok(req(), sel), true);
  assert.equal(ok(req({ securityOrigin: "https://owner.1helm.com/" }), sel), true, "Electron's securityOrigin has a trailing slash");
  assert.equal(ok(req({ audioRequested: false }), sel), false, "no sound asked for: no grant");
  assert.equal(ok(req({ frame: { url: "https://owner.1helm.com/w/owner/app", parent: {} } }), sel), false, "an embedded frame");
  assert.equal(ok(req({ frame: null }), sel), false, "a destroyed frame");
  assert.equal(ok(req({ frame: { url: "https://other.1helm.com/w/other/app", parent: null }, securityOrigin: "https://other.1helm.com" }), sel), false, "another host");
  assert.equal(ok(req({ frame: { url: "https://owner.1helm.com/p/unsafe/", parent: null } }), sel), false, "a page that is not the app");
  assert.equal(ok(req({ securityOrigin: "https://evil.example" }), sel), false, "origin mismatch");
  assert.equal(ok(req(), ""), false, "no server selected");
  assert.equal(ok(undefined, sel), false);
});
