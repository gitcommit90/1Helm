// The only executable in the platform-owned transport container. Never run agent code here.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"tailscale.com/derp/derphttp"
	"tailscale.com/ipn/store/mem"
	"tailscale.com/net/netmon"
	"tailscale.com/tsnet"
	"tailscale.com/types/key"
)

func quiet(string, ...any) {}
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
func probe(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	out := map[string]any{"boundary": "platform-owned broker; no agent code; agent Sentinel unchanged"}
	stage := r.URL.Query().Get("stage")
	targets := []string{"github.com:22", "ssh.github.com:443"}
	if stage != "" && stage != "ssh" {
		targets = nil
	}
	for _, target := range targets {
		c, e := (&net.Dialer{Timeout: 8 * time.Second}).DialContext(ctx, "tcp", target)
		result := map[string]any{"ok": false}
		if e == nil {
			c.SetReadDeadline(time.Now().Add(5 * time.Second))
			banner, err := bufio.NewReader(c).ReadString('\n')
			c.Close()
			if err == nil {
				result["ok"] = true
				result["banner"] = banner
			} else {
				result["error"] = err.Error()
			}
		} else {
			result["error"] = e.Error()
		}
		out[target] = result
	}
	if stage == "ssh" {
		writeJSON(w, out)
		return
	}
	if stage == "" || stage == "derp" {
		dc, e := derphttp.NewClient(key.NewNode(), "https://derp1.tailscale.com/derp", quiet, netmon.NewStatic())
		derpResult := map[string]any{"ok": false}
		if e == nil {
			defer dc.Close()
			e = dc.Connect(ctx)
			if e == nil {
				go func() {
					for {
						if _, err := dc.Recv(); err != nil {
							return
						}
					}
				}()
				e = dc.Ping(ctx)
			}
		}
		if e != nil {
			derpResult["error"] = e.Error()
		} else {
			derpResult["ok"] = true
			derpResult["protocol"] = "DERP authenticated handshake and ping/pong"
		}
		out["derp"] = derpResult
	}
	if stage == "derp" {
		writeJSON(w, out)
		return
	}
	dir, e := os.MkdirTemp("", "1hc-probe-")
	if e != nil {
		out["control"] = map[string]any{"ok": false, "error": e.Error()}
		writeJSON(w, out)
		return
	}
	defer os.RemoveAll(dir)
	s := &tsnet.Server{Dir: dir, Hostname: "1hc-transport-feasibility", Store: new(mem.Store), Ephemeral: true, UserLogf: quiet, Logf: quiet, ControlURL: "https://controlplane.tailscale.com"}
	defer s.Close()
	control := map[string]any{"ok": false, "enrolled": false}
	e = s.Start()
	if e == nil {
		lc, err := s.LocalClient()
		e = err
		if e == nil {
			for i := 0; i < 40; i++ {
				st, err := lc.Status(ctx)
				if err != nil {
					e = err
					break
				}
				if st.AuthURL != "" {
					control["ok"] = true
					control["state"] = st.BackendState
					control["interactive_login_url_received"] = true
					break
				}
				select {
				case <-ctx.Done():
					e = ctx.Err()
				case <-time.After(250 * time.Millisecond):
				}
				if e != nil {
					break
				}
			}
		}
	}
	if e != nil {
		control["error"] = e.Error()
	}
	out["control"] = control
	writeJSON(w, out)
}
func main() {
	for _, name := range []string{"TS_AUTHKEY", "TS_AUTH_KEY", "TS_CLIENT_SECRET", "TS_CLIENT_ID", "TS_ID_TOKEN", "TS_AUDIENCE", "TS_CONTROLURL", "TS_CONTROL_URL", "TSNET_FORCE_LOGIN"} {
		os.Unsetenv(name)
	}
	os.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	registerBroker(http.DefaultServeMux)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "service": "1hc-native-transport"})
	})
	http.HandleFunc("/probe", probe)
	fmt.Fprintln(os.Stderr, "native transport ready")
	if e := http.ListenAndServe(":8787", nil); e != nil {
		panic(e)
	}
}
