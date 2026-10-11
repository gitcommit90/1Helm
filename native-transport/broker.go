package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
)

const maxChunk = 1 << 20
const idleSession = 5 * time.Minute
const maxSession = 30 * time.Minute

type owner struct {
	Tenant  string `json:"tenant"`
	Channel string `json:"channel"`
}
type request struct {
	owner
	Op          string            `json:"op"`
	Seed        string            `json:"seed"`
	State       map[string]string `json:"state"`
	Epoch       int64             `json:"epoch"`
	KeyEpoch    int64             `json:"keyEpoch"`
	Host        string            `json:"host"`
	Address     string            `json:"address"`
	Port        int               `json:"port"`
	User        string            `json:"user"`
	Route       string            `json:"route"`
	PeerID      string            `json:"peerId"`
	PeerRoute   string            `json:"peerRoute"`
	Fingerprint string            `json:"fingerprint"`
	Session     string            `json:"session"`
	Task        string            `json:"task"`
	Turn        string            `json:"turn"`
	RequestID   string            `json:"requestId"`
	Expires     int64             `json:"expires"`
	Command     string            `json:"command"`
	Path        string            `json:"path"`
	Destination string            `json:"destination"`
	Data        string            `json:"data"`
	Encoding    string            `json:"encoding"`
	Offset      *int64            `json:"offset"`
	Length      int               `json:"length"`
	Truncate    bool              `json:"truncate"`
}
type managedSession struct {
	client            *ssh.Client
	request           request
	created, timeUsed time.Time
	active            int
}
type broker struct {
	mu           sync.Mutex
	lifecycle    sync.Mutex
	enrollment   sync.Mutex
	enrollCancel context.CancelFunc
	own          owner
	configured   bool
	signer       ssh.Signer
	tail         *tsnet.Server
	store        *remoteStore
	epoch        int64
	keyEpoch     int64
	tailDir      string
	sessions     map[string]*managedSession
	opening      map[string]*openingSession
	publicDial   func(context.Context, string) (net.Conn, error) // nil in the deployed runtime; local integration fixture injection
	policyError  error                                           // only inspected by unit tests; never returned or logged
}
type openingSession struct {
	request request
	cancel  context.CancelFunc
}
type remoteStore struct {
	mu       sync.Mutex
	values   map[string]string
	epoch    int64
	callback string
	failed   bool
}

func (s *remoteStore) ReadState(k ipn.StateKey) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.values[string(k)]
	if !ok {
		return nil, ipn.ErrStateNotExist
	}
	return base64.StdEncoding.DecodeString(v)
}
func (s *remoteStore) WriteState(k ipn.StateKey, v []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make(map[string]string, len(s.values)+1)
	for k, v := range s.values {
		next[k] = v
	}
	if v == nil {
		delete(next, string(k))
	} else {
		next[string(k)] = base64.StdEncoding.EncodeToString(v)
	}
	if s.callback != "" {
		body, _ := json.Marshal(map[string]any{"epoch": s.epoch, "state": next})
		client := &http.Client{Timeout: 10 * time.Second}
		resp, e := client.Post(s.callback, "application/json", bytes.NewReader(body))
		if e != nil {
			s.failed = true
			return errors.New("enrollment persistence unavailable")
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		resp.Body.Close()
		if resp.StatusCode != 200 {
			s.failed = true
			return errors.New("enrollment state invalidated")
		}
	}
	s.values = next
	return nil
}
func (s *remoteStore) healthy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.failed && s.values[string(ipn.MachineKeyStateKey)] != ""
}
func id() string { var b [16]byte; rand.Read(b[:]); return hex.EncodeToString(b[:]) }
func failure(s string) map[string]any {
	return map[string]any{"ok": false, "state": "error", "error": s}
}
func registerBroker(m *http.ServeMux) {
	b := &broker{sessions: map[string]*managedSession{}}
	m.HandleFunc("/rpc", b.handle)
	go b.sweep()
}
func (b *broker) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST required", 405)
		return
	}
	var q request
	if e := json.NewDecoder(io.LimitReader(r.Body, 3*maxChunk)).Decode(&q); e != nil {
		writeJSON(w, failure("Invalid transport request"))
		return
	}
	if q.Op == "configure" {
		writeJSON(w, b.configure(q))
		return
	}
	b.mu.Lock()
	ok := b.configured && q.owner == b.own
	b.mu.Unlock()
	if !ok {
		writeJSON(w, failure("Wrong computer identity"))
		return
	}
	timeout := 45 * time.Second
	if q.Op == "exec" || q.Op == "sftp" {
		timeout = 2 * time.Minute
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	var out any
	switch q.Op {
	case "identity":
		out = b.identity()
	case "status":
		out = b.status(ctx, false)
	case "tailscale_status":
		out = b.tailStatus(ctx)
	case "tailscale_connect":
		out = b.connect(ctx)
	case "tailscale_disconnect":
		out = b.disconnect(ctx, q.Epoch)
	case "prepare":
		out = b.prepare(ctx, q)
	case "open":
		out = b.open(ctx, q)
	case "exec":
		out = b.exec(ctx, q)
	case "sftp":
		out = b.sftp(ctx, q)
	case "close":
		out = b.close(q.Session)
	case "close_all":
		b.closeWhere(func(*managedSession) bool { return true })
		out = map[string]any{"ok": true}
	case "close_task":
		b.closeWhere(func(s *managedSession) bool { return s.request.Task == q.Task })
		out = map[string]any{"ok": true}
	default:
		out = failure("Unsupported transport operation")
	}
	writeJSON(w, out)
}
func (b *broker) configure(q request) any {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.configured {
		if b.own != q.owner || b.epoch != q.Epoch || b.keyEpoch != q.KeyEpoch {
			return failure("Computer epoch changed; restart required")
		}
		return map[string]any{"ok": true}
	}
	seed, e := base64.StdEncoding.DecodeString(q.Seed)
	if e != nil || len(seed) != ed25519.SeedSize || q.Tenant == "" || q.Channel == "" {
		return failure("Invalid computer identity")
	}
	signer, e := ssh.NewSignerFromKey(ed25519.NewKeyFromSeed(seed))
	for i := range seed {
		seed[i] = 0
	}
	if e != nil {
		return failure("Invalid SSH identity")
	}
	b.own = q.owner
	b.signer = signer
	b.epoch = q.Epoch
	b.keyEpoch = q.KeyEpoch
	b.configured = true
	if q.State == nil {
		q.State = map[string]string{}
	}
	b.store = &remoteStore{values: q.State, epoch: q.Epoch, callback: "http://native-state.internal/state"}
	return map[string]any{"ok": true}
}
func (b *broker) identity() any {
	b.mu.Lock()
	defer b.mu.Unlock()
	p := b.signer.PublicKey()
	return map[string]any{"ok": true, "key": map[string]any{"public_key": strings.TrimSpace(string(ssh.MarshalAuthorizedKey(p))), "fingerprint": ssh.FingerprintSHA256(p), "algorithm": "Ed25519"}}
}
func (b *broker) status(ctx context.Context, refresh bool) any {
	b.mu.Lock()
	sessions := []map[string]any{}
	for k, s := range b.sessions {
		sessions = append(sessions, map[string]any{"id": k, "destination": s.request.Host, "port": s.request.Port, "username": s.request.User, "route": s.request.Route, "tailnetEpoch": s.request.Epoch, "state": "connected", "task": s.request.Task, "turn": s.request.Turn, "requestId": s.request.RequestID, "expires_at": s.created.Add(maxSession).UnixMilli(), "idle_timeout_ms": idleSession.Milliseconds()})
	}
	b.mu.Unlock()
	return map[string]any{"ok": true, "sessions": sessions, "tailscale": b.tailStatus(ctx)}
}

// tsnet owns an independent userspace stack. No Listen, Loopback, proxy, TUN,
// fallback handler, Serve or Funnel endpoint is ever exposed to the agent.
func (b *broker) startTail(ctx context.Context) error {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	if b.tail != nil {
		return nil
	}
	if !b.confirmedEnrollment() {
		return errors.New("Tailscale is awaiting interactive enrollment approval")
	}
	dir, e := os.MkdirTemp("", "1hc-tail-")
	if e != nil {
		return e
	}
	name := b.deviceName()
	s := &tsnet.Server{Dir: dir, Store: b.store, Hostname: name, ControlURL: "https://controlplane.tailscale.com", UserLogf: quiet, Logf: quiet}
	if e = s.Start(); e != nil {
		s.Close()
		os.RemoveAll(dir)
		return errors.New("Tailscale client could not start")
	}
	lc, e := s.LocalClient()
	if e != nil {
		s.Close()
		os.RemoveAll(dir)
		return e
	}
	_, e = lc.EditPrefs(ctx, &ipn.MaskedPrefs{Prefs: ipn.Prefs{ShieldsUp: true, WantRunning: true, RouteAll: true}, ShieldsUpSet: true, WantRunningSet: true, RunSSHSet: true, RunWebClientSet: true, RouteAllSet: true, ExitNodeIDSet: true, ExitNodeIPSet: true, AutoExitNodeSet: true, CorpDNSSet: true, AdvertiseRoutesSet: true, AdvertiseTagsSet: true})
	if e == nil {
		// Serve configuration requires an authenticated netmap. Before login no
		// tsnet listener exists; clear it again before reporting Running below.
		if st, err := lc.Status(ctx); err == nil && st.BackendState == "Running" {
			e = lc.SetServeConfig(ctx, nil)
		}
	}
	if e == nil {
		p, err := lc.GetPrefs(ctx)
		e = err
		if e == nil && (!p.ShieldsUp || p.RunSSH || p.RunWebClient || !p.RouteAll || p.ExitNodeID != "" || p.ExitNodeIP.IsValid() || p.AutoExitNode != "" || len(p.AdvertiseRoutes) > 0 || len(p.AdvertiseTags) > 0) {
			e = errors.New("outbound-only policy could not be verified")
		}
	}
	if e != nil {
		b.policyError = e
		s.Close()
		os.RemoveAll(dir)
		return errors.New("Tailscale outbound-only policy failed closed")
	}
	b.tail = s
	b.tailDir = dir
	return nil
}
func (b *broker) connect(ctx context.Context) any {
	b.enrollment.Lock()
	defer b.enrollment.Unlock()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	b.mu.Lock()
	b.enrollCancel = cancel
	b.mu.Unlock()
	defer func() { b.mu.Lock(); b.enrollCancel = nil; b.mu.Unlock() }()
	if !b.confirmedEnrollment() {
		r, e := b.registrationStep(ctx)
		if e != nil {
			return failure(e.Error())
		}
		if r != nil {
			return r
		}
	}
	if e := b.repairIncompleteAdoption(ctx); e != nil {
		return failure(e.Error())
	}
	if e := b.startTail(ctx); e != nil {
		return failure(e.Error())
	}
	return waitTailReady(ctx, b.tailStatus)
}

// Start is asynchronous: a restored tsnet profile is not connected until its
// control map arrives. Both UI status and every cold SSH prepare/open must wait
// for this same bounded readiness check. Waiting never grants SSH permission.
func waitTailReady(ctx context.Context, status func(context.Context) map[string]any) map[string]any {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	for {
		if ctx.Err() != nil {
			return failure("Tailscale is still reconnecting its saved identity. Retry status; do not disconnect or enroll another device.")
		}
		v := status(ctx)
		state, _ := v["state"].(string)
		if state == "connected" || state == "awaiting_user_approval" || state == "expired_revoked" {
			return v
		}
		select {
		case <-ctx.Done():
			return failure("Tailscale is still reconnecting its saved identity. Retry status; do not disconnect or enroll another device.")
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func (b *broker) resumeTail(ctx context.Context) map[string]any {
	b.enrollment.Lock()
	defer b.enrollment.Unlock()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	b.mu.Lock()
	b.enrollCancel = cancel
	b.mu.Unlock()
	defer func() { b.mu.Lock(); b.enrollCancel = nil; b.mu.Unlock() }()
	if ctx.Err() != nil {
		return failure("Tailscale reconnect cancelled")
	}
	if !b.confirmedEnrollment() {
		return failure("This computer has no confirmed Tailscale enrollment. Inspect native network status first.")
	}
	if e := b.repairIncompleteAdoption(ctx); e != nil {
		return failure(e.Error())
	}
	if e := b.startTail(ctx); e != nil {
		return failure(e.Error())
	}
	return waitTailReady(ctx, b.tailStatus)
}
func (b *broker) tailStatus(ctx context.Context) map[string]any {
	b.lifecycle.Lock()
	s := b.tail
	store := b.store
	b.lifecycle.Unlock()
	if s == nil {
		if data, e := store.ReadState(pendingState); e == nil {
			var pending pendingEnrollment
			if json.Unmarshal(data, &pending) == nil && pending.URL != "" {
				return map[string]any{"state": "awaiting_user_approval", "login_url": pending.URL}
			}
		}
		return map[string]any{"state": "disconnected"}
	}
	lc, e := s.LocalClient()
	if e != nil {
		return failure("Tailscale client unavailable")
	}
	st, e := lc.Status(ctx)
	if e != nil {
		return map[string]any{"state": "offline_reconnecting", "error": "Tailscale status unavailable"}
	}
	if !store.healthy() {
		return failure("Tailscale identity is not durably saved. Connection blocked; retry after checking platform storage.")
	}
	if st.BackendState == "Running" {
		if e := lc.SetServeConfig(ctx, nil); e != nil {
			return failure("Tailscale serving policy could not be cleared; access blocked")
		}
	}
	_, memberError := store.ReadState(memberState)
	return tailStatusView(st, memberError == nil)
}

func tailStatusView(st *ipnstate.Status, registered bool) map[string]any {
	out := map[string]any{"state": "joining", "outbound_only": true}
	switch st.BackendState {
	case "Running":
		if st.Self == nil {
			out["state"] = "offline_reconnecting"
			break
		}
		if st.Self.Expired {
			out["state"] = "expired_revoked"
			break
		}
		if !st.Self.Online || len(st.Health) > 0 {
			out["state"] = "offline_reconnecting"
			break
		}
		out["state"] = "connected"
		out["device_id"] = string(st.Self.ID)
		// HostName is the requested OS hostname and can repeat after a deliberate
		// new enrollment. DNSName is control's unique assigned name (e.g. -1).
		dnsName := strings.TrimSuffix(st.Self.DNSName, ".")
		if dnsName != "" {
			out["device_name"] = strings.SplitN(dnsName, ".", 2)[0]
			out["dns_name"] = dnsName
		} else {
			out["device_name"] = st.Self.HostName
		}
		ips := []string{}
		for _, ip := range st.TailscaleIPs {
			ips = append(ips, ip.String())
		}
		out["addresses"] = ips
	case "NeedsLogin":
		out["state"] = "error"
		out["error"] = "Tailscale membership could not be verified. Retry status; if the problem persists, inspect this device in Tailscale. This state alone does not establish expiry or revocation."
		if st.AuthURL != "" && !registered {
			out["state"] = "awaiting_user_approval"
			out["login_url"] = st.AuthURL
			delete(out, "error")
		}
	case "NeedsMachineAuth":
		out["state"] = "awaiting_user_approval"
		out["next"] = "A Tailscale administrator must approve this enrolled computer."
	case "Stopped":
		out["state"] = "offline_reconnecting"
	}
	return out
}
func (b *broker) disconnect(ctx context.Context, epoch int64) any {
	b.closeWhere(func(s *managedSession) bool { return s.request.Route == "tailnet" })
	b.mu.Lock()
	if b.enrollCancel != nil {
		b.enrollCancel()
	}
	b.mu.Unlock()
	b.enrollment.Lock()
	defer b.enrollment.Unlock()
	// A sleeping computer can restore solely to log out. The platform already
	// invalidated persistence, so logout-only writes stay in this doomed memory.
	b.store.mu.Lock()
	b.store.callback = ""
	hasState := len(b.store.values) > 0
	b.store.mu.Unlock()
	if b.tail == nil && hasState {
		_ = b.startTail(ctx)
	}
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	loggedOut := false
	if b.tail != nil {
		if lc, e := b.tail.LocalClient(); e == nil {
			prefs, prefsError := lc.GetPrefs(ctx)
			st, statusError := lc.Status(ctx)
			// Upstream Logout returns nil without remote I/O when no node key is
			// loaded. Only confirm logout of a known running authenticated profile.
			known := prefsError == nil && prefs.Persist != nil && !prefs.Persist.PrivateNodeKey.IsZero() && prefs.Persist.NodeID != "" && statusError == nil && st.BackendState == "Running" && st.Self != nil && st.Self.ID == prefs.Persist.NodeID
			logoutError := lc.Logout(ctx)
			loggedOut = known && logoutError == nil
		}
		b.tail.Close()
		b.tail = nil
	}
	if b.tailDir != "" {
		os.RemoveAll(b.tailDir)
		b.tailDir = ""
	}
	b.mu.Lock()
	b.epoch = epoch
	b.mu.Unlock()
	b.store = &remoteStore{values: map[string]string{}, epoch: epoch, callback: "http://native-state.internal/state"}
	return map[string]any{"ok": true, "state": "disconnected", "remote_logout_confirmed": loggedOut}
}

var blockedPublic = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"), netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("224.0.0.0/3"), netip.MustParsePrefix("::/96"), netip.MustParsePrefix("64:ff9b::/96"), netip.MustParsePrefix("64:ff9b:1::/48"), netip.MustParsePrefix("100::/64"), netip.MustParsePrefix("2001::/23"), netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"), netip.MustParsePrefix("fc00::/7"), netip.MustParsePrefix("fe80::/10"), netip.MustParsePrefix("ff00::/8"),
}

func publicAddress(s string) bool {
	a, e := netip.ParseAddr(s)
	if e != nil || a.Zone() != "" {
		return false
	}
	a = a.Unmap()
	if !a.IsGlobalUnicast() || a.IsPrivate() || a.IsLoopback() || a.IsLinkLocalUnicast() {
		return false
	}
	for _, p := range blockedPublic {
		if p.Contains(a) {
			return false
		}
	}
	return true
}
func validate(q request) error {
	if q.Host == "" || len(q.Host) > 253 || strings.ContainsAny(q.Host, " /@?#\\\t\r\n") || q.User == "" || len(q.User) > 64 || q.Port < 1 || q.Port > 65535 || (q.Route != "public" && q.Route != "tailnet") {
		return errors.New("Invalid SSH destination")
	}
	for _, r := range q.User {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("_.-", r)) {
			return errors.New("Invalid SSH username")
		}
	}
	return nil
}
func (b *broker) tailPeer(ctx context.Context, host string) (*ipnstate.PeerStatus, string, string, error) {
	ready := b.resumeTail(ctx)
	if ready["state"] != "connected" {
		message, _ := ready["error"].(string)
		if message == "" {
			message = "Tailscale membership is not active for this operation. Inspect native status; do not start a duplicate enrollment."
		}
		return nil, "", "", errors.New(message)
	}
	b.lifecycle.Lock()
	s := b.tail
	b.lifecycle.Unlock()
	if s == nil {
		return nil, "", "", errors.New("Tailscale disconnected")
	}
	lc, e := s.LocalClient()
	if e != nil {
		return nil, "", "", errors.New("Tailscale disconnected")
	}
	st, e := lc.Status(ctx)
	if e != nil {
		return nil, "", "", e
	}
	if tailStatusView(st, true)["state"] != "connected" {
		return nil, "", "", errors.New("Tailscale membership changed while resolving the target; retry status before requesting SSH")
	}
	return resolveTailPeer(st, host)
}
func resolveTailPeer(st *ipnstate.Status, host string) (*ipnstate.PeerStatus, string, string, error) {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	for _, p := range st.Peer {
		matches := host == strings.TrimSuffix(strings.ToLower(p.DNSName), ".") || host == strings.ToLower(p.HostName)
		for _, ip := range p.TailscaleIPs {
			matches = matches || host == ip.String()
		}
		if matches {
			if p.Expired || len(p.TailscaleIPs) == 0 {
				return nil, "", "", errors.New("Tailnet target expired or has no address")
			}
			address := p.TailscaleIPs[0].String()
			for _, ip := range p.TailscaleIPs {
				if ip.String() == host {
					address = host
				}
			}
			return p, address, "", nil
		}
	}
	// Private subnet targets use an already-authorized primary route. Never use
	// a default/exit route or introduce advertised routes or policy changes.
	ip, err := netip.ParseAddr(host)
	if err == nil && ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
		var selected *ipnstate.PeerStatus
		var prefix netip.Prefix
		ambiguous := false
		for _, p := range st.Peer {
			if p.Expired || p.PrimaryRoutes == nil {
				continue
			}
			for _, route := range p.PrimaryRoutes.All() {
				if route.Bits() == 0 || !route.Contains(ip) {
					continue
				}
				if !prefix.IsValid() || route.Bits() > prefix.Bits() {
					selected = p
					prefix = route
					ambiguous = false
				} else if route.Bits() == prefix.Bits() && selected.ID != p.ID {
					ambiguous = true
				}
			}
		}
		if selected != nil && !ambiguous {
			return selected, ip.String(), prefix.String(), nil
		}
	}
	return nil, "", "", errors.New("Tailnet target has no uniquely verified peer or existing private subnet route. Use a Tailscale address/MagicDNS name, or ask your administrator to provide an authorized subnet route.")
}
func (b *broker) prepare(ctx context.Context, q request) any {
	if e := validate(q); e != nil {
		return failure(e.Error())
	}
	out := map[string]any{"ok": true, "host": q.Host, "port": q.Port, "user": q.User, "route": q.Route}
	if q.Route == "tailnet" {
		p, address, route, e := b.tailPeer(ctx, q.Host)
		if e != nil {
			return failure(e.Error())
		}
		out["address"] = address
		out["peerId"] = string(p.ID)
		out["peerRoute"] = route
		b.lifecycle.Lock()
		out["tailnetEpoch"] = b.epoch
		b.lifecycle.Unlock()
		return out
	}
	h := strings.TrimSuffix(strings.ToLower(q.Host), ".")
	if h == "1helm.com" || strings.HasSuffix(h, ".1helm.com") || h == "localhost" || strings.HasSuffix(h, ".internal") {
		return failure("Platform and internal destinations are not public SSH targets")
	}
	ips, e := net.DefaultResolver.LookupNetIP(ctx, "ip", strings.Trim(q.Host, "[]"))
	if e != nil || len(ips) == 0 {
		return failure("Public SSH hostname could not be resolved. Cloudflare Tunnel hostnames require a separate tunnel-aware connector, which is not supported.")
	}
	ss := []string{}
	for _, ip := range ips {
		if !publicAddress(ip.String()) {
			return failure("Public route resolves to an internal, reserved, or tailnet address; choose a verified tailnet target instead")
		}
		ss = append(ss, ip.Unmap().String())
	}
	sort.Strings(ss)
	out["address"] = ss[0]
	return out
}
func (b *broker) open(ctx context.Context, q request) any {
	if e := validate(q); e != nil {
		return failure(e.Error())
	}
	if q.Expires <= time.Now().UnixMilli() {
		return failure("SSH approval expired before connecting")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	openingID := id()
	b.mu.Lock()
	if b.opening == nil {
		b.opening = map[string]*openingSession{}
	}
	b.opening[openingID] = &openingSession{request: q, cancel: cancel}
	b.mu.Unlock()
	defer func() { b.mu.Lock(); delete(b.opening, openingID); b.mu.Unlock() }()
	var conn net.Conn
	var e error
	if q.Route == "public" {
		if !publicAddress(q.Address) {
			return failure("Pinned public address is not permitted")
		}
		address := net.JoinHostPort(q.Address, fmt.Sprint(q.Port))
		if b.publicDial != nil {
			conn, e = b.publicDial(ctx, address)
		} else {
			conn, e = (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", address)
		}
	} else {
		p, address, route, err := b.tailPeer(ctx, q.Host)
		if err != nil {
			return failure(err.Error())
		}
		b.lifecycle.Lock()
		tail, epoch := b.tail, b.epoch
		b.lifecycle.Unlock()
		if tail == nil || address != q.Address || route != q.PeerRoute || string(p.ID) != q.PeerID || q.Epoch != epoch {
			return failure("Tailnet destination or enrollment changed; request fresh approval")
		}
		// Pinned Tailscale version exposes this lower-level API. Unlike Server.Dial,
		// NetstackDialTCP has no operating-system/public-network fallback.
		dial := tail.Sys().Dialer.Get().NetstackDialTCP
		if dial == nil {
			return failure("Tailscale userspace-only dial is unavailable; connection blocked")
		}
		conn, e = dial(ctx, netip.AddrPortFrom(netip.MustParseAddr(q.Address), uint16(q.Port)))
	}
	if e != nil {
		return failure("SSH destination is unreachable on the approved route. Check its address, port, firewall and tailnet policy. No fallback route was used.")
	}
	conn.SetDeadline(time.Now().Add(20 * time.Second))
	stopCancel := context.AfterFunc(ctx, func() { conn.Close() })
	defer stopCancel()
	observed := ""
	b.mu.Lock()
	signer := b.signer
	b.mu.Unlock()
	config := &ssh.ClientConfig{User: q.User, Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)}, Timeout: 20 * time.Second, HostKeyCallback: func(_ string, _ net.Addr, k ssh.PublicKey) error {
		observed = ssh.FingerprintSHA256(k)
		if q.Fingerprint == "" || q.Fingerprint != observed {
			return errors.New("host key confirmation required")
		}
		return nil
	}}
	cc, ch, req, e := ssh.NewClientConn(conn, net.JoinHostPort(q.Address, fmt.Sprint(q.Port)), config)
	if e != nil {
		conn.Close()
		if observed != "" && observed != q.Fingerprint {
			return map[string]any{"ok": false, "state": "host_key_confirmation_required", "fingerprint": observed, "changed": q.Fingerprint != "", "previous_fingerprint": q.Fingerprint}
		}
		return failure("SSH authentication or protocol handshake failed. Install this computer's public key for the approved username; passwords and private-key uploads are not supported.")
	}
	conn.SetDeadline(time.Time{})
	client := ssh.NewClient(cc, ch, req)
	sid := id()
	s := &managedSession{client: client, request: q, created: time.Now(), timeUsed: time.Now()}
	b.mu.Lock()
	if ctx.Err() != nil || q.Expires <= time.Now().UnixMilli() {
		b.mu.Unlock()
		client.Close()
		return failure("SSH opening was cancelled")
	}
	b.sessions[sid] = s
	b.mu.Unlock()
	go func() { client.Wait(); b.close(sid) }()
	return map[string]any{"ok": true, "state": "connected", "session": sid, "fingerprint": observed, "expires_at": s.created.Add(maxSession).UnixMilli(), "idle_timeout_ms": idleSession.Milliseconds()}
}
func (b *broker) use(q request) (*managedSession, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.sessions[q.Session]
	if s == nil || s.request.Task != q.Task || s.request.Turn != q.Turn {
		return nil, errors.New("No active session belongs to this task and run")
	}
	if s.request.Route == "tailnet" && (q.Epoch != s.request.Epoch || q.Epoch != b.epoch) {
		return nil, errors.New("Tailscale session belongs to an invalidated enrollment")
	}
	s.timeUsed = time.Now()
	s.active++
	return s, nil
}
func (b *broker) release(s *managedSession) {
	b.mu.Lock()
	s.active--
	s.timeUsed = time.Now()
	b.mu.Unlock()
}

type limitedBuffer struct {
	mu        sync.Mutex
	buffer    bytes.Buffer // do not embed: io.Copy would bypass Write via promoted ReadFrom
	remaining int
	truncated bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	if len(p) > b.remaining {
		p = p[:max(0, b.remaining)]
		b.truncated = true
	}
	b.buffer.Write(p)
	b.remaining -= len(p)
	return n, nil
}
func (b *limitedBuffer) String() string { b.mu.Lock(); defer b.mu.Unlock(); return b.buffer.String() }
func (b *broker) exec(ctx context.Context, q request) any {
	if len(q.Command) > 65536 || q.Command == "" {
		return failure("Supply a remote command up to 64 KiB")
	}
	s, e := b.use(q)
	if e != nil {
		return failure(e.Error())
	}
	defer b.release(s)
	stopTimeout := context.AfterFunc(ctx, func() { b.close(q.Session) })
	defer stopTimeout()
	ss, e := s.client.NewSession()
	if e != nil {
		return failure("Approved SSH session has ended; request another approval")
	}
	defer ss.Close()
	out := &limitedBuffer{remaining: maxChunk}
	ss.Stdout = out
	ss.Stderr = out
	done := make(chan error, 1)
	go func() { done <- ss.Run(q.Command) }()
	code := 0
	select {
	case e = <-done:
		if e != nil {
			var exit *ssh.ExitError
			if errors.As(e, &exit) {
				code = exit.ExitStatus()
			} else {
				return failure("Remote command failed or session disconnected")
			}
		}
	case <-ctx.Done():
		b.close(q.Session)
		return failure("Remote command timed out; the approved transport was closed. A new connection requires another approval.")
	}
	return map[string]any{"ok": true, "exit_code": code, "output": out.String(), "truncated": out.truncated}
}
func (b *broker) sftp(ctx context.Context, q request) any {
	s, e := b.use(q)
	if e != nil {
		return failure(e.Error())
	}
	defer b.release(s)
	stopTimeout := context.AfterFunc(ctx, func() { b.close(q.Session) })
	defer stopTimeout()
	c, e := sftp.NewClient(s.client)
	if e != nil {
		return failure("Remote SFTP service unavailable")
	}
	defer c.Close()
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			c.Close()
		case <-done:
		}
	}()
	out := map[string]any{"ok": true}
	offset := int64(0)
	if q.Offset != nil {
		offset = *q.Offset
	}
	if offset < 0 {
		return failure("SFTP offset must not be negative")
	}
	length := q.Length
	if length == 0 {
		length = maxChunk
	}
	if length < 1 || length > maxChunk {
		return failure("SFTP chunks must be at most 1 MiB")
	}
	switch q.Command {
	case "list":
		var files []os.FileInfo
		files, e = c.ReadDir(q.Path)
		if e == nil {
			entries := []map[string]any{}
			for i, f := range files {
				if i >= 1000 {
					out["truncated"] = true
					break
				}
				entries = append(entries, map[string]any{"name": f.Name(), "size": f.Size(), "directory": f.IsDir(), "mode": f.Mode().String()})
			}
			out["entries"] = entries
		}
	case "stat":
		var f os.FileInfo
		f, e = c.Stat(q.Path)
		if e == nil {
			out["size"] = f.Size()
			out["directory"] = f.IsDir()
			out["mode"] = f.Mode().String()
		}
	case "read":
		var f *sftp.File
		f, e = c.Open(q.Path)
		if e == nil {
			defer f.Close()
			_, e = f.Seek(offset, io.SeekStart)
			if e == nil {
				data := make([]byte, length)
				var n int
				n, e = io.ReadFull(f, data)
				eof := e == io.EOF || e == io.ErrUnexpectedEOF
				if eof {
					e = nil
				}
				data = data[:n]
				if q.Encoding == "base64" {
					out["data"] = base64.StdEncoding.EncodeToString(data)
					out["encoding"] = "base64"
				} else {
					out["data"] = string(data)
					out["encoding"] = "utf8"
				}
				out["bytes"] = n
				out["offset"] = offset
				out["next_offset"] = offset + int64(n)
				out["eof"] = eof
			}
		}
	case "write":
		data := []byte(q.Data)
		if q.Encoding == "base64" {
			data, e = base64.StdEncoding.DecodeString(q.Data)
		}
		if e == nil && len(data) > maxChunk {
			return failure("SFTP chunks must be at most 1 MiB")
		}
		if e == nil {
			flags := os.O_WRONLY | os.O_CREATE
			if q.Offset == nil || q.Truncate {
				flags |= os.O_TRUNC
			}
			var f *sftp.File
			f, e = c.OpenFile(q.Path, flags)
			if e == nil {
				var n int
				n, e = f.WriteAt(data, offset)
				f.Close()
				out["bytes"] = n
				out["next_offset"] = offset + int64(n)
			}
		}
	case "mkdir":
		e = c.Mkdir(q.Path)
	case "remove":
		e = c.Remove(q.Path)
	case "rename":
		e = c.Rename(q.Path, q.Destination)
	default:
		return failure("Unsupported SFTP operation")
	}
	if e != nil {
		return failure("SFTP operation failed; check the remote path, account permissions and session status")
	}
	return out
}
func (b *broker) close(sid string) any {
	b.mu.Lock()
	s := b.sessions[sid]
	delete(b.sessions, sid)
	b.mu.Unlock()
	if s != nil {
		s.client.Close()
	}
	return map[string]any{"ok": true, "state": "closed"}
}
func (b *broker) closeWhere(f func(*managedSession) bool) {
	b.mu.Lock()
	for _, pending := range b.opening {
		if f(&managedSession{request: pending.request, created: time.Now(), timeUsed: time.Now(), active: 1}) {
			pending.cancel()
		}
	}
	ids := []string{}
	for k, s := range b.sessions {
		if f(s) {
			ids = append(ids, k)
		}
	}
	b.mu.Unlock()
	for _, k := range ids {
		b.close(k)
	}
}
func (b *broker) sweep() {
	for range time.Tick(5 * time.Second) {
		b.closeWhere(func(s *managedSession) bool {
			return time.Since(s.created) > maxSession || (s.active == 0 && time.Since(s.timeUsed) > idleSession)
		})
	}
}
