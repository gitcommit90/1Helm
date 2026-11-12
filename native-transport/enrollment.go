package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"tailscale.com/control/controlclient"
	"tailscale.com/health"
	"tailscale.com/ipn"
	"tailscale.com/net/netmon"
	"tailscale.com/net/tsdial"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
	"tailscale.com/types/netmap"
	"tailscale.com/types/persist"
	"tailscale.com/util/eventbus"
)

const pendingState ipn.StateKey = "_1hc_pending_enrollment"
const memberState ipn.StateKey = "_1hc_authenticated_enrollment"

type pendingEnrollment struct {
	Persist    persist.Persist
	URL        string
	Registered bool
}

func (b *broker) deviceName() string {
	name := "1hc-" + b.own.Channel
	if len(name) > 35 {
		name = name[:35]
	}
	return name + "-" + b.own.Tenant[:min(8, len(b.own.Tenant))]
}
func (b *broker) confirmedEnrollment() bool { _, e := b.store.ReadState(memberState); return e == nil }

// tsnet's ordinary interactive login keeps tryingNewKey only in RAM until
// approval. A billable daemon cannot remain awake waiting for a person. Use the
// upstream registration client with our persisted node key, then let tsnet's
// supported legacy-state migration adopt the authenticated identity.
func (b *broker) registrationStep(ctx context.Context) (map[string]any, error) {
	var pending pendingEnrollment
	data, e := b.store.ReadState(pendingState)
	if e == nil {
		if json.Unmarshal(data, &pending) != nil {
			return nil, errors.New("Pending enrollment state could not be read")
		}
	} else {
		pending.Persist = persist.Persist{PrivateNodeKey: key.NewNode(), NetworkLockKey: key.NewNLPrivate()}
		data, _ = json.Marshal(pending)
		if e = b.store.WriteState(pendingState, data); e != nil {
			return nil, e
		}
	}
	var machine key.MachinePrivate
	raw, e := b.store.ReadState(ipn.MachineKeyStateKey)
	if e == nil {
		if machine.UnmarshalText(raw) != nil {
			return nil, errors.New("Invalid computer enrollment identity")
		}
	} else {
		machine = key.NewMachine()
		raw, _ = machine.MarshalText()
		if e = b.store.WriteState(ipn.MachineKeyStateKey, raw); e != nil {
			return nil, e
		}
	}
	direct, closeClient, e := b.registrationClient(machine, pending.Persist)
	if e != nil {
		return nil, errors.New("Tailscale registration client unavailable")
	}
	defer closeClient()
	// LoginDefault means reuse the durable key rather than force key rotation.
	// An unregistered key still requires the real interactive human login URL.
	var url string
	if pending.Registered {
		// Registration was accepted before a prior sleep/map timeout. Never
		// start another interactive login when only identity adoption remains.
	} else if pending.URL != "" {
		poll, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		url, e = direct.WaitLoginURL(poll, pending.URL)
		if errors.Is(e, context.DeadlineExceeded) && ctx.Err() == nil {
			return map[string]any{"state": "awaiting_user_approval", "login_url": pending.URL, "device_name": b.deviceName()}, nil
		}
	} else {
		url, e = direct.TryLogin(ctx, controlclient.LoginDefault)
	}
	if e != nil {
		b.policyError = e
		return nil, errors.New("Tailscale registration could not complete; retry status")
	}
	pending.Persist = *direct.GetPersist().AsStruct()
	pending.URL = url
	pending.Registered = url == ""
	data, _ = json.Marshal(pending)
	if e = b.store.WriteState(pendingState, data); e != nil {
		return nil, e
	}
	if url != "" {
		return map[string]any{"state": "awaiting_user_approval", "login_url": url, "device_name": b.deviceName()}, nil
	}
	if e = completeRegisteredIdentity(ctx, direct, pending.Persist.PrivateNodeKey); e != nil {
		return nil, e
	}
	pending.Persist = *direct.GetPersist().AsStruct()
	return nil, b.adoptRegisteredIdentity(pending.Persist)
}

func (b *broker) registrationClient(machine key.MachinePrivate, saved persist.Persist) (*controlclient.Direct, func(), error) {
	bus := eventbus.New()
	monitor := netmon.NewStatic()
	dialer := tsdial.NewDialer(monitor)
	dialer.SetBus(bus)
	closeResources := func() { dialer.Close(); monitor.Close(); bus.Close() }
	logID := sha256.Sum256([]byte(machine.Public().String()))
	direct, err := controlclient.NewDirect(controlclient.Options{Persist: saved, GetMachinePrivateKey: func() (key.MachinePrivate, error) { return machine, nil }, ServerURL: "https://controlplane.tailscale.com", Hostinfo: &tailcfg.Hostinfo{Hostname: b.deviceName(), OS: "linux", ShieldsUp: true, BackendLogID: hex.EncodeToString(logID[:])}, Dialer: dialer, Bus: bus, HealthTracker: health.NewTracker(bus), Logf: quiet})
	if err != nil {
		closeResources()
		return nil, func() {}, err
	}
	return direct, func() { direct.Close(); closeResources() }, nil
}

type enrollmentMapClient interface {
	PollNetMap(context.Context, controlclient.NetmapUpdater) error
	GetPersist() persist.PersistView
}
type enrollmentMap struct {
	cancel   context.CancelFunc
	node     key.NodePublic
	id       tailcfg.StableNodeID
	verified bool
}

func (m *enrollmentMap) UpdateFullNetmap(n *netmap.NetworkMap) {
	// No netmap leaves the trusted process. Require the registered key and an
	// actual stable ID from authenticated control, never synthesize a NodeID.
	m.verified = n != nil && n.SelfNode.Valid() && n.SelfNode.StableID() != "" && n.SelfNode.Key() == m.node && !n.SelfNode.Expired() && (n.SelfNode.KeyExpiry().IsZero() || n.SelfNode.KeyExpiry().After(time.Now()))
	if m.verified {
		m.id = n.SelfNode.StableID()
	}
	m.cancel()
}
func completeRegisteredIdentity(ctx context.Context, client enrollmentMapClient, node key.NodePrivate) error {
	if node.IsZero() {
		return errors.New("Saved Tailscale node identity is unavailable; access blocked")
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	m := &enrollmentMap{cancel: cancel, node: node.Public()}
	_ = client.PollNetMap(ctx, m)
	p := client.GetPersist()
	if !m.verified || !p.Valid() || p.NodeID() != m.id || p.UserProfile().LoginName() == "" || !p.PrivateNodeKey().Equal(node) {
		return errors.New("Tailscale approved identity could not be verified; retry status. No new enrollment was started.")
	}
	return nil
}

func (b *broker) adoptRegisteredIdentity(saved persist.Persist) error {
	if saved.PrivateNodeKey.IsZero() || saved.NodeID == "" || saved.UserProfile.LoginName == "" {
		return errors.New("Tailscale identity adoption requires a verified device identity")
	}
	prefs := ipn.NewPrefs()
	prefs.ControlURL = "https://controlplane.tailscale.com"
	prefs.Hostname = b.deviceName()
	prefs.WantRunning = true
	prefs.ShieldsUp = true
	prefs.RouteAll = true
	prefs.CorpDNS = false
	prefs.Persist = &saved
	data, e := json.Marshal(prefs)
	if e != nil {
		return e
	}
	if e = b.store.WriteState(ipn.LegacyGlobalDaemonStateKey, data); e != nil {
		return e
	}
	if e = b.store.WriteState(memberState, []byte("authenticated")); e != nil {
		return e
	}
	if e = b.store.WriteState(pendingState, nil); e != nil {
		return e
	}
	return nil
}

// Repair only the precise pre-fix incomplete legacy adoption. Use its existing
// machine/node keys to request a map, never TryLogin, rotate, or create a node.
// Normal profiles (including later revoked identities) never enter this path.
func (b *broker) repairIncompleteAdoption(ctx context.Context) error {
	data, err := b.store.ReadState(ipn.LegacyGlobalDaemonStateKey)
	if err != nil {
		return nil
	}
	var prefs ipn.Prefs
	if json.Unmarshal(data, &prefs) != nil || prefs.Persist == nil {
		return errors.New("Saved Tailscale profile could not be read; access blocked")
	}
	if prefs.Persist.NodeID != "" {
		return nil
	}
	p := prefs.Persist
	if p.PrivateNodeKey.IsZero() || p.UserProfile.LoginName == "" {
		return errors.New("Saved Tailscale enrollment identity is incomplete; access blocked")
	}
	if data, err = b.store.ReadState(ipn.KnownProfilesStateKey); err == nil {
		var profiles map[string]json.RawMessage
		if json.Unmarshal(data, &profiles) != nil || len(profiles) != 0 {
			return errors.New("Tailscale profile requires inspection; access blocked")
		}
	}
	if data, err = b.store.ReadState(ipn.CurrentProfileStateKey); err == nil && len(data) > 0 {
		return errors.New("Tailscale selected profile requires inspection; access blocked")
	}
	data, err = b.store.ReadState(ipn.MachineKeyStateKey)
	var machine key.MachinePrivate
	if err != nil || machine.UnmarshalText(data) != nil || machine.IsZero() {
		return errors.New("Saved Tailscale machine identity is unavailable; access blocked")
	}
	client, closeClient, err := b.registrationClient(machine, *p)
	if err != nil {
		return errors.New("Tailscale identity verification unavailable")
	}
	defer closeClient()
	if err = completeRegisteredIdentity(ctx, client, p.PrivateNodeKey); err != nil {
		return err
	}
	return b.adoptRegisteredIdentity(*client.GetPersist().AsStruct())
}
