package main

// Browser exit node support (the only place the broker carries traffic that is not SSH).
//
// The person picks one exit-node-capable device on their own tailnet. While the setting is on, the
// computer's Chrome sends its traffic to this broker over a WebSocket (one WebSocket per TCP
// connection), and the broker dials the destination through that exit node with the userspace
// netstack. Rules that keep it narrow:
//   - Only the exit node the person picked is ever used. The broker never selects one itself.
//   - The destination must be a public internet address. Tailnet addresses, private ranges,
//     loopback and link-local addresses are refused, so this is not a way to reach the tailnet.
//   - The dial uses NetstackDialTCP only after UserDialPlan says the route is through Tailscale.
//     There is no operating-system fallback, so an offline exit node fails the connection and
//     never sends the traffic directly from the Cloudflare datacenter.
//   - No listener is opened on the tailnet and no SOCKS or HTTP proxy listener exists in this
//     process. The only entry is the platform-owned /proxy path that the NativeTransport object
//     reaches over the container port, so agent programs cannot connect to it.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
)

const maxProxyConns = 128

var proxyActive atomic.Int32

type exitNodeView struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	DNSName string `json:"dns_name,omitempty"`
	OS      string `json:"os,omitempty"`
	Online  bool   `json:"online"`
}

// exitNodesFrom lists the peers that offer themselves as an exit node and are approved to be one.
func exitNodesFrom(st *ipnstate.Status) []exitNodeView {
	out := []exitNodeView{}
	if st == nil {
		return out
	}
	for _, p := range st.Peer {
		if p == nil || !p.ExitNodeOption {
			continue
		}
		dns := strings.TrimSuffix(p.DNSName, ".")
		name := p.HostName
		if dns != "" {
			name = strings.SplitN(dns, ".", 2)[0]
		}
		out = append(out, exitNodeView{ID: string(p.ID), Name: name, DNSName: dns, OS: p.OS, Online: p.Online})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Online != out[j].Online {
			return out[i].Online
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// exitProblem says, in plain words, why the chosen exit node cannot carry traffic right now ("" when it can).
func exitProblem(id string, st *ipnstate.Status) string {
	if id == "" {
		return "No exit node is selected."
	}
	if st == nil || st.BackendState != "Running" || st.Self == nil || !st.Self.Online {
		return "Tailscale is not connected on this computer."
	}
	for _, n := range exitNodesFrom(st) {
		if n.ID == id {
			if !n.Online {
				return "The exit node " + n.Name + " is offline."
			}
			if st.ExitNodeStatus == nil || string(st.ExitNodeStatus.ID) != id {
				return "Tailscale has not switched to the exit node " + n.Name + " yet."
			}
			if !st.ExitNodeStatus.Online {
				return "The exit node " + n.Name + " is offline."
			}
			return ""
		}
	}
	return "The selected device is no longer an approved exit node on your tailnet."
}

// proxyTarget checks a destination the browser asked for. Names and public addresses only.
func proxyTarget(host string, port int) error {
	if port < 1 || port > 65535 || host == "" || len(host) > 253 || strings.ContainsAny(host, " /@?#\\\t\r\n") {
		return errors.New("Invalid destination")
	}
	if strings.HasPrefix(host, "[") || strings.Contains(host, ":") {
		host = strings.Trim(host, "[]")
	}
	if strings.HasSuffix(strings.ToLower(host), ".ts.net") || strings.EqualFold(host, "localhost") || !strings.Contains(host, ".") && !strings.Contains(host, ":") {
		return errors.New("The browser exit node only reaches public websites")
	}
	return nil
}

func (b *broker) exitID() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.exit
}

func (b *broker) applyExit(ctx context.Context) error {
	b.lifecycle.Lock()
	s := b.tail
	b.lifecycle.Unlock()
	if s == nil {
		return nil
	}
	lc, e := s.LocalClient()
	if e != nil {
		return e
	}
	_, e = lc.EditPrefs(ctx, &ipn.MaskedPrefs{Prefs: ipn.Prefs{ExitNodeID: tailcfg.StableNodeID(b.exitID())}, ExitNodeIDSet: true, ExitNodeIPSet: true, AutoExitNodeSet: true, ExitNodeAllowLANAccessSet: true})
	return e
}

// exitConfig records the exit node the person chose ("" clears it) and applies it to a running client.
func (b *broker) exitConfig(ctx context.Context, id string) any {
	if len(id) > 128 || strings.ContainsAny(id, " /\\\t\r\n") {
		return failure("Invalid exit node")
	}
	b.mu.Lock()
	b.exit = id
	b.mu.Unlock()
	if e := b.applyExit(ctx); e != nil {
		return failure("The exit node could not be applied. Retry.")
	}
	return map[string]any{"ok": true, "exit_node_id": id}
}

// exitList starts the saved Tailscale identity if needed and lists the tailnet's exit-node-capable devices.
func (b *broker) exitList(ctx context.Context) any {
	ready := b.resumeTail(ctx)
	if ready["state"] != "connected" {
		return map[string]any{"ok": false, "state": ready["state"], "error": firstString(ready["error"], "Tailscale is not connected on this computer.")}
	}
	b.lifecycle.Lock()
	s := b.tail
	b.lifecycle.Unlock()
	if s == nil {
		return failure("Tailscale client unavailable")
	}
	lc, e := s.LocalClient()
	if e != nil {
		return failure("Tailscale client unavailable")
	}
	st, e := lc.Status(ctx)
	if e != nil {
		return failure("Tailscale status unavailable")
	}
	id := b.exitID()
	return map[string]any{"ok": true, "nodes": exitNodesFrom(st), "selected": id, "problem": exitProblem(id, st)}
}

// exitCheck answers whether browser traffic could leave through the chosen exit node right now.
func (b *broker) exitCheck(ctx context.Context) any {
	b.mu.Lock()
	if b.exitCached != nil && time.Since(b.exitCachedAt) < 3*time.Second && b.exitCachedFor == b.exit {
		v := b.exitCached
		b.mu.Unlock()
		return v
	}
	b.mu.Unlock()
	v := b.exitCheckNow(ctx)
	b.mu.Lock()
	if m, ok := v.(map[string]any); ok {
		b.exitCached, b.exitCachedAt, b.exitCachedFor = m, time.Now(), b.exit
	}
	b.mu.Unlock()
	return v
}

func (b *broker) exitCheckNow(ctx context.Context) any {
	id := b.exitID()
	if id == "" {
		return map[string]any{"ok": false, "reason": "No exit node is selected."}
	}
	ready := b.resumeTail(ctx)
	if ready["state"] != "connected" {
		return map[string]any{"ok": false, "reason": firstString(ready["error"], "Tailscale is not connected on this computer.")}
	}
	b.lifecycle.Lock()
	s := b.tail
	b.lifecycle.Unlock()
	if s == nil {
		return map[string]any{"ok": false, "reason": "Tailscale is not connected on this computer."}
	}
	lc, e := s.LocalClient()
	if e != nil {
		return map[string]any{"ok": false, "reason": "Tailscale is not connected on this computer."}
	}
	// The exit node takes a moment to become the active route after it is applied.
	var st *ipnstate.Status
	for i := 0; i < 20; i++ {
		st, e = lc.Status(ctx)
		if e == nil && exitProblem(id, st) == "" {
			break
		}
		if ctx.Err() != nil {
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if e != nil {
		return map[string]any{"ok": false, "reason": "Tailscale status is unavailable."}
	}
	if p := exitProblem(id, st); p != "" {
		return map[string]any{"ok": false, "reason": p}
	}
	return map[string]any{"ok": true}
}

func firstString(v any, d string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return d
}

// exitDial opens one TCP connection to a public destination through the chosen exit node, or says why not.
func (b *broker) exitDial(ctx context.Context, host string, port int) (net.Conn, string) {
	if e := proxyTarget(host, port); e != nil {
		return nil, e.Error()
	}
	if c, _ := b.exitCheck(ctx).(map[string]any); c == nil || c["ok"] != true {
		return nil, firstString(c["reason"], "The exit node is unavailable.")
	}
	b.lifecycle.Lock()
	s := b.tail
	b.lifecycle.Unlock()
	if s == nil {
		return nil, "Tailscale is not connected on this computer."
	}
	d := s.Sys().Dialer.Get()
	if d == nil || d.NetstackDialTCP == nil {
		return nil, "The Tailscale userspace dialer is unavailable."
	}
	ipp, viaTailscale, e := d.UserDialPlan(ctx, "tcp", net.JoinHostPort(strings.Trim(host, "[]"), itoa(port)))
	if e != nil {
		return nil, "The address of " + host + " could not be looked up."
	}
	if !viaTailscale {
		return nil, "No route to " + host + " through the exit node. Nothing was sent directly."
	}
	if !publicAddress(ipp.Addr().String()) {
		return nil, "The browser exit node only reaches public websites."
	}
	conn, e := d.NetstackDialTCP(ctx, ipp)
	if e != nil {
		return nil, "The exit node could not reach " + host + "."
	}
	return conn, ""
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

type proxyHello struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

// proxy carries one browser TCP connection. The first message is {host, port}; the answer is {ok} or {ok:false, reason}.
// Then both sides exchange binary messages until either closes.
func (b *broker) proxy(w http.ResponseWriter, r *http.Request) {
	if proxyActive.Load() >= maxProxyConns {
		http.Error(w, "too many browser connections", http.StatusServiceUnavailable)
		return
	}
	b.mu.Lock()
	ok := b.configured
	b.mu.Unlock()
	if !ok {
		http.Error(w, "not configured", http.StatusConflict)
		return
	}
	if b.exitID() == "" {
		// Fail closed before the upgrade, so the caller sees a plain status.
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "reason": "No exit node is selected."})
		return
	}
	c, e := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if e != nil {
		return
	}
	proxyActive.Add(1)
	defer proxyActive.Add(-1)
	defer c.CloseNow()
	c.SetReadLimit(1 << 20)
	ctx := r.Context()
	hctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	_, msg, e := c.Read(hctx)
	cancel()
	var h proxyHello
	if e != nil || json.Unmarshal(msg, &h) != nil {
		c.Close(websocket.StatusPolicyViolation, "bad request")
		return
	}
	dctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	conn, reason := b.exitDial(dctx, h.Host, h.Port)
	cancel()
	reply := map[string]any{"ok": conn != nil}
	if conn == nil {
		reply["reason"] = reason
	}
	body, _ := json.Marshal(reply)
	if e := c.Write(ctx, websocket.MessageText, body); e != nil || conn == nil {
		if conn != nil {
			conn.Close()
		}
		c.Close(websocket.StatusNormalClosure, "")
		return
	}
	defer conn.Close()
	nc := websocket.NetConn(ctx, c, websocket.MessageBinary)
	done := make(chan struct{}, 2)
	go func() { io.Copy(conn, nc); done <- struct{}{} }()
	go func() { io.Copy(nc, conn); done <- struct{}{} }()
	<-done
}
