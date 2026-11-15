package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"tailscale.com/control/controlclient"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnlocal"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
	"tailscale.com/types/netmap"
	"tailscale.com/types/persist"
)

// Exercise the pinned upstream loader, not a mock of the migration. A successful
// registration response has a user and private key but no NodeID until /map.
func TestAuthenticatedRegistrationRequiresNetmapBeforeLegacyAdoption(t *testing.T) {
	for _, hasNodeID := range []bool{false, true} {
		s := &remoteStore{values: map[string]string{}}
		p := ipn.NewPrefs()
		p.ControlURL = "https://controlplane.tailscale.com"
		p.Persist = &persist.Persist{PrivateNodeKey: key.NewNode(), UserProfile: tailcfg.UserProfile{ID: 1, LoginName: "fixture@example.com"}}
		if hasNodeID {
			p.Persist.NodeID = "fixture-node"
		}
		data, _ := json.Marshal(p)
		if err := s.WriteState(ipn.LegacyGlobalDaemonStateKey, data); err != nil {
			t.Fatal(err)
		}
		got, err := ipnlocal.ReadStartupPrefsForTest(quiet, s)
		if err != nil {
			t.Fatal(err)
		}
		preserved := got.Persist().Valid() && got.Persist().PrivateNodeKey().Equal(p.Persist.PrivateNodeKey)
		if preserved != hasNodeID {
			t.Fatalf("node identity present=%v, upstream retained registered key=%v", hasNodeID, preserved)
		}
	}
}

type fixtureEnrollmentClient struct {
	p   persist.Persist
	n   *netmap.NetworkMap
	err error
}

func (f *fixtureEnrollmentClient) GetPersist() persist.PersistView { return f.p.View() }
func (f *fixtureEnrollmentClient) PollNetMap(ctx context.Context, u controlclient.NetmapUpdater) error {
	if f.n != nil {
		u.UpdateFullNetmap(f.n)
	}
	return f.err
}
func TestRegisteredIdentityRequiresAuthenticatedMatchingLiveMap(t *testing.T) {
	for _, scenario := range []string{"valid", "missing_map", "missing_self", "wrong_key", "wrong_id", "expired", "past_expiry", "missing_login", "changed_persist_key"} {
		t.Run(scenario, func(t *testing.T) {
			k := key.NewNode()
			self := &tailcfg.Node{StableID: "fixture-node", Key: k.Public()}
			f := &fixtureEnrollmentClient{p: persist.Persist{PrivateNodeKey: k, NodeID: self.StableID, UserProfile: tailcfg.UserProfile{LoginName: "fixture@example.com"}}, n: &netmap.NetworkMap{}}
			switch scenario {
			case "wrong_key":
				self.Key = key.NewNode().Public()
			case "wrong_id":
				f.p.NodeID = "other-node"
			case "expired":
				self.Expired = true
			case "past_expiry":
				self.KeyExpiry = time.Now().Add(-time.Hour)
			case "missing_login":
				f.p.UserProfile.LoginName = ""
			case "changed_persist_key":
				f.p.PrivateNodeKey = key.NewNode()
			}
			f.n.SelfNode = self.View()
			if scenario == "missing_self" {
				f.n = &netmap.NetworkMap{}
			}
			if scenario == "missing_map" {
				f.n = nil
				f.err = errors.New("network unavailable")
			}
			if got := completeRegisteredIdentity(context.Background(), f, k); (got == nil) != (scenario == "valid") {
				t.Fatalf("unexpected verification result: %v", got)
			}
		})
	}
}

func TestAdoptionPreservesIdentityAcrossUpstreamProfileRestore(t *testing.T) {
	s := &remoteStore{values: map[string]string{}}
	b := &broker{own: owner{Tenant: "fixture-tenant", Channel: "main"}, store: s}
	p := persist.Persist{PrivateNodeKey: key.NewNode(), NodeID: "fixture-node", UserProfile: tailcfg.UserProfile{ID: 1, LoginName: "fixture@example.com"}}
	if err := b.adoptRegisteredIdentity(p); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		got, err := ipnlocal.ReadStartupPrefsForTest(quiet, s)
		if err != nil {
			t.Fatal(err)
		}
		if !got.Persist().Valid() || !got.Persist().PrivateNodeKey().Equal(p.PrivateNodeKey) || got.Persist().NodeID() != p.NodeID {
			t.Fatal("approved identity lost during restore")
		}
		if !got.ShieldsUp() || got.RunSSH() || got.RunWebClient() || got.ExitNodeID() != "" || got.ExitNodeIP().IsValid() || got.AdvertiseRoutes().Len() != 0 {
			t.Fatal("outbound-only preferences lost")
		}
	}
}

func TestAdoptionRejectsIncompleteIdentityWithoutWrites(t *testing.T) {
	s := &remoteStore{values: map[string]string{}}
	b := &broker{own: owner{Tenant: "fixture-tenant", Channel: "main"}, store: s}
	if err := b.adoptRegisteredIdentity(persist.Persist{PrivateNodeKey: key.NewNode()}); err == nil {
		t.Fatal("incomplete identity adopted")
	}
	if len(s.values) != 0 {
		t.Fatal("failed adoption wrote state")
	}
}

func TestRepairNeverRevertsOrReenrollsNormalProfiles(t *testing.T) {
	s := &remoteStore{values: map[string]string{}}
	b := &broker{own: owner{Tenant: "fixture-tenant", Channel: "main"}, store: s}
	p := persist.Persist{PrivateNodeKey: key.NewNode(), NodeID: "fixture-node", UserProfile: tailcfg.UserProfile{ID: 1, LoginName: "fixture@example.com"}}
	if err := b.adoptRegisteredIdentity(p); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(s.values)
	if err := b.repairIncompleteAdoption(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(s.values)
	if string(before) != string(after) {
		t.Fatal("normal profile modified")
	}
	// Incomplete old legacy state must not overwrite an existing newer profile.
	p.NodeID = ""
	data, _ := json.Marshal(&ipn.Prefs{Persist: &p})
	s.WriteState(ipn.LegacyGlobalDaemonStateKey, data)
	s.WriteState(ipn.KnownProfilesStateKey, []byte(`{"existing":{}}`))
	before, _ = json.Marshal(s.values)
	if err := b.repairIncompleteAdoption(context.Background()); err == nil {
		t.Fatal("existing profile was not protected")
	}
	after, _ = json.Marshal(s.values)
	if string(before) != string(after) {
		t.Fatal("existing profile modified")
	}
}

func TestStatusDoesNotInventRevocationOrReadiness(t *testing.T) {
	for _, tc := range []struct {
		name       string
		status     ipnstate.Status
		registered bool
		want       string
	}{
		{"missing-self", ipnstate.Status{BackendState: "Running"}, true, "offline_reconnecting"},
		{"needs-login", ipnstate.Status{BackendState: "NeedsLogin", AuthURL: "private-unused-url"}, true, "error"},
		{"confirmed-expired", ipnstate.Status{BackendState: "Running", Self: &ipnstate.PeerStatus{Expired: true, Online: true}}, true, "expired_revoked"},
		{"offline", ipnstate.Status{BackendState: "Running", Self: &ipnstate.PeerStatus{Online: false}}, true, "offline_reconnecting"},
		{"healthy", ipnstate.Status{BackendState: "Running", Self: &ipnstate.PeerStatus{Online: true}}, true, "connected"},
		{"pending", ipnstate.Status{BackendState: "NeedsLogin", AuthURL: "private-pending-url"}, false, "awaiting_user_approval"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := tailStatusView(&tc.status, tc.registered)
			if got["state"] != tc.want {
				t.Fatalf("state=%v want=%s", got["state"], tc.want)
			}
			if tc.registered {
				if _, ok := got["login_url"]; ok {
					t.Fatal("registered device unexpectedly offered fresh enrollment")
				}
			}
		})
	}
}

func TestColdTailReadinessWaitsForAuthenticatedStateEveryWake(t *testing.T) {
	// The pre-fix SSH path sampled the first joining state and failed. Both
	// prepare and approved open now use the same readiness function as Connect.
	for wake := 0; wake < 2; wake++ {
		calls := 0
		got := waitTailReady(context.Background(), func(context.Context) map[string]any {
			calls++
			if calls < 3 {
				return map[string]any{"state": "joining"}
			}
			return map[string]any{"state": "connected", "device_id": "same-approved-device"}
		})
		if calls != 3 || got["state"] != "connected" {
			t.Fatal("cold identity did not wait for control readiness")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if got := waitTailReady(ctx, func(context.Context) map[string]any { return map[string]any{"state": "offline_reconnecting"} }); got["ok"] != false {
		t.Fatal("unready identity was accepted")
	}
	if got := waitTailReady(context.Background(), func(context.Context) map[string]any { return map[string]any{"state": "expired_revoked"} }); got["state"] != "expired_revoked" {
		t.Fatal("expiry was ignored")
	}
}
func TestSSHResumeNeverStartsUnapprovedEnrollment(t *testing.T) {
	b := &broker{store: &remoteStore{values: map[string]string{}}}
	if got := b.resumeTail(context.Background()); got["ok"] != false {
		t.Fatal("unregistered resume accepted")
	}
	if len(b.store.values) != 0 {
		t.Fatal("SSH resume generated an enrollment identity")
	}
}
func TestAssignedDeviceNameIsNotRequestedHostname(t *testing.T) {
	got := tailStatusView(&ipnstate.Status{BackendState: "Running", Self: &ipnstate.PeerStatus{Online: true, ID: "stable-current", HostName: "1hc-main-fixture", DNSName: "1hc-main-fixture-1.example.ts.net."}}, true)
	if got["device_name"] != "1hc-main-fixture-1" || got["dns_name"] != "1hc-main-fixture-1.example.ts.net" || got["device_id"] != "stable-current" {
		t.Fatal("status did not identify actual assigned device")
	}
}
func TestBrokerRejectsInvalidatedTailSessionButKeepsPublicSession(t *testing.T) {
	for _, route := range []string{"tailnet", "public"} {
		b := &broker{epoch: 2, sessions: map[string]*managedSession{"fixture": {request: request{Task: "task", Turn: "run", Route: route, Epoch: 1}}}}
		for _, epoch := range []int64{0, 1, 2} {
			s, err := b.use(request{Session: "fixture", Task: "task", Turn: "run", Epoch: epoch})
			if (err == nil) != (route == "public") {
				t.Fatal("invalidated tailnet session became usable")
			}
			if err == nil {
				b.release(s)
			}
		}
	}
	b := &broker{epoch: 2, sessions: map[string]*managedSession{"fixture": {request: request{Task: "task", Turn: "run", Route: "tailnet", Epoch: 2}}}}
	s, err := b.use(request{Session: "fixture", Task: "task", Turn: "run", Epoch: 2})
	if err != nil {
		t.Fatal(err)
	}
	b.release(s)
}
