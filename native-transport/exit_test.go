package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
)

func exitStatus(selected string, online bool, active bool) *ipnstate.Status {
	st := &ipnstate.Status{BackendState: "Running", Self: &ipnstate.PeerStatus{Online: true}, Peer: map[key.NodePublic]*ipnstate.PeerStatus{}}
	st.Peer[key.NewNode().Public()] = &ipnstate.PeerStatus{ID: "n-home", HostName: "home", DNSName: "home.tail1.ts.net.", ExitNodeOption: true, Online: online, OS: "linux"}
	st.Peer[key.NewNode().Public()] = &ipnstate.PeerStatus{ID: "n-laptop", HostName: "laptop", DNSName: "laptop.tail1.ts.net.", Online: true}
	st.Peer[key.NewNode().Public()] = &ipnstate.PeerStatus{ID: "n-nas", HostName: "nas", DNSName: "nas.tail1.ts.net.", ExitNodeOption: true, Online: true}
	if active && selected != "" {
		st.ExitNodeStatus = &ipnstate.ExitNodeStatus{ID: tailcfg.StableNodeID(selected), Online: online}
	}
	return st
}

func TestExitNodesListOnlyOfferedExitNodes(t *testing.T) {
	list := exitNodesFrom(exitStatus("", true, false))
	if len(list) != 2 || list[0].Name != "home" || list[1].Name != "nas" {
		t.Fatalf("unexpected list %+v", list)
	}
	if exitNodesFrom(nil) == nil {
		t.Fatal("nil status must give an empty list")
	}
}

func TestExitProblemFailsClosed(t *testing.T) {
	cases := []struct {
		name string
		id   string
		st   *ipnstate.Status
		want string
	}{
		{"none selected", "", exitStatus("", true, false), "No exit node is selected."},
		{"no status", "n-home", nil, "Tailscale is not connected"},
		{"exit node offline", "n-home", exitStatus("n-home", false, true), "offline"},
		{"not yet active", "n-home", exitStatus("n-home", true, false), "has not switched"},
		{"no longer an exit node", "n-laptop", exitStatus("n-laptop", true, true), "no longer an approved exit node"},
		{"ready", "n-home", exitStatus("n-home", true, true), ""},
	}
	for _, c := range cases {
		got := exitProblem(c.id, c.st)
		if c.want == "" && got != "" || !strings.Contains(got, c.want) {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

func TestProxyTargetRefusesNonPublicNames(t *testing.T) {
	for _, bad := range []string{"", "localhost", "intranet", "home.tail1.ts.net", "a b.com", "x.com/path"} {
		if proxyTarget(bad, 443) == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
	if proxyTarget("www.reddit.com", 0) == nil || proxyTarget("www.reddit.com", 70000) == nil {
		t.Error("bad ports must be refused")
	}
	if e := proxyTarget("www.reddit.com", 443); e != nil {
		t.Errorf("public name refused: %v", e)
	}
}

func TestExitConfigRejectsBadIDAndKeepsSetting(t *testing.T) {
	b := &broker{sessions: map[string]*managedSession{}}
	if r, _ := b.exitConfig(context.Background(), "bad id").(map[string]any); r["ok"] != false {
		t.Fatal("space in id must be refused")
	}
	if r, _ := b.exitConfig(context.Background(), "n-home").(map[string]any); r["ok"] != true || b.exitID() != "n-home" {
		t.Fatalf("exit not saved: %v", r)
	}
	if r, _ := b.exitConfig(context.Background(), "").(map[string]any); r["ok"] != true || b.exitID() != "" {
		t.Fatal("exit not cleared")
	}
}

func TestProxyRefusesWhenNoExitNodeAndWhenTailscaleIsDown(t *testing.T) {
	b := &broker{sessions: map[string]*managedSession{}, configured: true, store: &remoteStore{values: map[string]string{}}}
	srv := httptest.NewServer(http.HandlerFunc(b.proxy))
	defer srv.Close()
	// No exit node chosen: a plain 503 with the reason, before any WebSocket upgrade.
	resp, e := http.Get(srv.URL)
	if e != nil || resp.StatusCode != 503 {
		t.Fatalf("want 503, got %v %v", resp, e)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if body["ok"] != false || !strings.Contains(body["reason"].(string), "No exit node") {
		t.Fatalf("unexpected body %v", body)
	}
	// An exit node is chosen but Tailscale never started: the answer is a refusal, never a direct connection.
	b.exitConfig(context.Background(), "n-home")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c, _, e := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if e != nil {
		t.Fatal(e)
	}
	defer c.CloseNow()
	c.Write(ctx, websocket.MessageText, []byte(`{"host":"www.reddit.com","port":443}`))
	_, msg, e := c.Read(ctx)
	if e != nil {
		t.Fatal(e)
	}
	var reply map[string]any
	json.Unmarshal(msg, &reply)
	if reply["ok"] != false || reply["reason"] == "" {
		t.Fatalf("expected a refusal with a reason, got %s", msg)
	}
}
