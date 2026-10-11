package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
	"tailscale.com/types/views"
)

func signer(t *testing.T) ssh.Signer {
	t.Helper()
	_, k, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	s, e := ssh.NewSignerFromKey(k)
	if e != nil {
		t.Fatal(e)
	}
	return s
}

type fixture struct {
	address string
	host    ssh.Signer
	auth    atomic.Int32
}

func sshFixture(t *testing.T, authorized ssh.PublicKey) *fixture {
	t.Helper()
	f := &fixture{host: signer(t)}
	ln, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	f.address = ln.Addr().String()
	t.Cleanup(func() { ln.Close() })
	config := &ssh.ServerConfig{PublicKeyCallback: func(_ ssh.ConnMetadata, k ssh.PublicKey) (*ssh.Permissions, error) {
		f.auth.Add(1)
		if bytes.Equal(k.Marshal(), authorized.Marshal()) {
			return nil, nil
		}
		return nil, fmt.Errorf("unrecognized key")
	}}
	config.AddHostKey(f.host)
	go func() {
		for {
			c, e := ln.Accept()
			if e != nil {
				return
			}
			go func() {
				defer c.Close()
				sc, channels, reqs, e := ssh.NewServerConn(c, config)
				if e != nil {
					return
				}
				defer sc.Close()
				go ssh.DiscardRequests(reqs)
				for ch := range channels {
					if ch.ChannelType() != "session" {
						ch.Reject(ssh.Prohibited, "only sessions")
						continue
					}
					channel, requests, e := ch.Accept()
					if e != nil {
						continue
					}
					go func() {
						defer channel.Close()
						for r := range requests {
							switch r.Type {
							case "exec":
								var q struct{ Command string }
								if ssh.Unmarshal(r.Payload, &q) != nil {
									r.Reply(false, nil)
									continue
								}
								r.Reply(true, nil)
								command := exec.Command("sh", "-c", q.Command)
								command.Stdout = channel
								command.Stderr = channel.Stderr()
								err := command.Run()
								status := uint32(0)
								if err != nil {
									status = 1
								}
								channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{status}))
								return
							case "subsystem":
								var q struct{ Name string }
								ssh.Unmarshal(r.Payload, &q)
								if q.Name != "sftp" {
									r.Reply(false, nil)
									continue
								}
								r.Reply(true, nil)
								srv, e := sftp.NewServer(channel)
								if e == nil {
									srv.Serve()
									srv.Close()
								}
								return
							default:
								r.Reply(false, nil)
							}
						}
					}()
				}
			}()
		}
	}()
	return f
}
func fixtureBroker(t *testing.T) (*broker, *fixture, request) {
	t.Helper()
	s := signer(t)
	f := sshFixture(t, s.PublicKey())
	b := &broker{configured: true, own: owner{"tenant-a", "main"}, signer: s, sessions: map[string]*managedSession{}}
	b.publicDial = func(ctx context.Context, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", f.address)
	}
	t.Cleanup(func() { b.closeWhere(func(*managedSession) bool { return true }) })
	q := request{owner: b.own, Host: "fixture.example", Address: "8.8.8.8", Port: 2222, User: "fixture", Route: "public", Task: "task-a", Turn: "run-a", RequestID: "approved-a", Expires: time.Now().Add(time.Minute).UnixMilli()}
	return b, f, q
}
func result(t *testing.T, v any) map[string]any {
	t.Helper()
	r, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("bad result %#v", v)
	}
	return r
}
func TestHostVerificationAndRealSSHAndSFTP(t *testing.T) {
	b, f, q := fixtureBroker(t)
	ctx := context.Background()
	r := result(t, b.open(ctx, q))
	if r["state"] != "host_key_confirmation_required" {
		t.Fatal(r)
	}
	if f.auth.Load() != 0 {
		t.Fatal("private-key authentication attempted before host confirmation")
	}
	q.Fingerprint = r["fingerprint"].(string)
	r = result(t, b.open(ctx, q))
	if r["ok"] != true {
		t.Fatal(r)
	}
	q.Session = r["session"].(string)
	q.Command = "printf hello; printf stderr >&2"
	r = result(t, b.exec(ctx, q))
	if r["exit_code"] != 0 || !strings.Contains(r["output"].(string), "hello") || !strings.Contains(r["output"].(string), "stderr") {
		t.Fatal(r)
	}
	dir := t.TempDir()
	q.Path = filepath.Join(dir, "upload.bin")
	q.Command = "write"
	q.Encoding = "base64"
	payload := bytes.Repeat([]byte{0, 1, 255, 120}, maxChunk/4)
	q.Data = base64.StdEncoding.EncodeToString(payload)
	r = result(t, b.sftp(ctx, q))
	if r["ok"] != true {
		t.Fatal(r)
	}
	off := int64(maxChunk)
	q.Offset = &off
	q.Data = base64.StdEncoding.EncodeToString([]byte("second chunk"))
	r = result(t, b.sftp(ctx, q))
	if r["ok"] != true {
		t.Fatal(r)
	}
	q.Command = "read"
	q.Length = 100
	q.Data = ""
	r = result(t, b.sftp(ctx, q))
	decoded, _ := base64.StdEncoding.DecodeString(r["data"].(string))
	if string(decoded) != "second chunk" || r["eof"] != true {
		t.Fatal(r)
	}
	actual, e := os.ReadFile(q.Path)
	if e != nil || !bytes.Equal(actual, append(payload, []byte("second chunk")...)) {
		t.Fatal("chunked SFTP content mismatch", e)
	}
	q.Command = "rename"
	q.Destination = filepath.Join(dir, "renamed.bin")
	r = result(t, b.sftp(ctx, q))
	if r["ok"] != true {
		t.Fatal(r)
	}
	q.Path = q.Destination
	q.Command = "stat"
	r = result(t, b.sftp(ctx, q))
	if r["size"] != int64(maxChunk+12) {
		t.Fatal(r)
	}
	q.Command = "remove"
	if result(t, b.sftp(ctx, q))["ok"] != true {
		t.Fatal("remove failed")
	}
	changed := q
	changed.Fingerprint = "SHA256:replacement"
	before := f.auth.Load()
	r = result(t, b.open(ctx, changed))
	if r["state"] != "host_key_confirmation_required" || f.auth.Load() != before {
		t.Fatal("changed host key was not blocked before authentication", r)
	}
	wrong := q
	wrong.Task = "other-task"
	wrong.Command = "id"
	if result(t, b.exec(ctx, wrong))["ok"] != false {
		t.Fatal("cross-task session used")
	}
	b.close(q.Session)
	if result(t, b.exec(ctx, q))["ok"] != false {
		t.Fatal("closed session reused")
	}
}
func TestPublicDestinationProtection(t *testing.T) {
	for _, a := range []string{"127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.2.3", "192.168.8.185", "100.64.0.1", "169.254.169.254", "fd7a:115c:a1e0::1", "fe80::1%eth0", "64:ff9b::a00:1", "2002:a00:100::1", "192.0.2.1", "224.0.0.1"} {
		if publicAddress(a) {
			t.Errorf("accepted %s", a)
		}
	}
	for _, a := range []string{"8.8.8.8", "2606:4700:4700::1111"} {
		if !publicAddress(a) {
			t.Errorf("rejected public %s", a)
		}
	}
}
func TestRoutePinning(t *testing.T) {
	routes := views.SliceOf([]netip.Prefix{netip.MustParsePrefix("192.168.8.0/24")})
	p := &ipnstate.PeerStatus{ID: tailcfg.StableNodeID("router-1"), TailscaleIPs: []netip.Addr{netip.MustParseAddr("100.80.0.1")}, PrimaryRoutes: &routes}
	st := &ipnstate.Status{Peer: map[key.NodePublic]*ipnstate.PeerStatus{key.NewNode().Public(): p}}
	got, addr, prefix, e := resolveTailPeer(st, "192.168.8.185")
	if e != nil || got.ID != p.ID || addr != "192.168.8.185" || prefix != "192.168.8.0/24" {
		t.Fatal(got, addr, prefix, e)
	}
	p.PrimaryRoutes = nil
	if _, _, _, e = resolveTailPeer(st, "192.168.8.185"); e == nil {
		t.Fatal("withdrawn route accepted")
	}
	defaults := views.SliceOf([]netip.Prefix{netip.MustParsePrefix("0.0.0.0/0")})
	p.PrimaryRoutes = &defaults
	if _, _, _, e = resolveTailPeer(st, "192.168.8.185"); e == nil {
		t.Fatal("exit-node fallback accepted")
	}
}
func TestPendingConnectionCancelledAndExpired(t *testing.T) {
	b, _, q := fixtureBroker(t)
	started := make(chan struct{})
	b.publicDial = func(ctx context.Context, _ string) (net.Conn, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	done := make(chan any)
	go func() { done <- b.open(context.Background(), q) }()
	<-started
	b.closeWhere(func(*managedSession) bool { return true })
	select {
	case r := <-done:
		if result(t, r)["ok"] != false {
			t.Fatal(r)
		}
	case <-time.After(time.Second):
		t.Fatal("pending dial survived cancellation")
	}
	q.Expires = time.Now().Add(-time.Second).UnixMilli()
	if result(t, b.open(context.Background(), q))["ok"] != false {
		t.Fatal("expired approval accepted")
	}
}
func TestStateCallbackFailureIsStickyAndDoesNotPersist(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.Copy(io.Discard, r.Body); w.WriteHeader(409) }))
	defer srv.Close()
	s := &remoteStore{values: map[string]string{}, callback: srv.URL}
	if s.WriteState(ipn.MachineKeyStateKey, []byte("fixture-secret")) == nil {
		t.Fatal("callback invalidation ignored")
	}
	if s.healthy() {
		t.Fatal("unpersisted identity marked healthy")
	}
	if _, e := s.ReadState(ipn.MachineKeyStateKey); e == nil {
		t.Fatal("failed write retained")
	}
}

// Explicit opt-in: real control-plane login generation, never enrollment. No URL,
// private key, token or state value is printed. Exercises waiting through sleep.
func TestInteractiveLoginStateSurvivesSleep(t *testing.T) {
	if os.Getenv("ONEHC_LIVE_LOGIN_PROBE") != "1" {
		t.Skip("requires explicit real control-plane probe")
	}
	for _, name := range []string{"TS_AUTHKEY", "TS_AUTH_KEY", "TS_CLIENT_SECRET", "TS_CLIENT_ID", "TSNET_FORCE_LOGIN"} {
		t.Setenv(name, "")
	}
	t.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	newBroker := func(state map[string]string) *broker {
		return &broker{configured: true, own: owner{"fixture-persistence", "test"}, signer: signer(t), sessions: map[string]*managedSession{}, store: &remoteStore{values: state}}
	}
	b := newBroker(map[string]string{})
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	first := result(t, b.connect(ctx))
	if first["state"] != "awaiting_user_approval" {
		t.Fatalf("login did not become ready: state=%v error=%v policy=%v", first["state"], first["error"], b.policyError)
	}
	if b.tail != nil {
		b.tail.Close()
	}
	os.RemoveAll(b.tailDir)
	state := b.store.values
	machineBefore := state[string(ipn.MachineKeyStateKey)]
	pendingBefore := state[string(pendingState)]
	secondBroker := newBroker(state)
	defer func() {
		if secondBroker.tail != nil {
			secondBroker.tail.Close()
		}
		os.RemoveAll(secondBroker.tailDir)
	}()
	second := result(t, secondBroker.connect(ctx))
	if second["state"] != "awaiting_user_approval" {
		t.Fatalf("restored login not ready: state=%v error=%v", second["state"], second["error"])
	}
	if first["login_url"] != second["login_url"] {
		t.Fatal("pending login URL changed across persisted-state restart; do not claim waiting flow resumes")
	}
	third := result(t, newBroker(secondBroker.store.values).connect(ctx))
	if first["login_url"] != third["login_url"] || secondBroker.store.values[string(ipn.MachineKeyStateKey)] != machineBefore || secondBroker.store.values[string(pendingState)] != pendingBefore {
		t.Fatal("pending URL or machine/node identity changed across repeated wake")
	}
}
