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
