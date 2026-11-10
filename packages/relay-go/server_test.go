package main

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func testServer(t *testing.T) (*httptest.Server, *Server) {
	t.Helper()
	st, err := openStore(filepath.Join(t.TempDir(), "relay.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })
	static, err := fs.Sub(frontendFS, "frontend")
	if err != nil {
		t.Fatal(err)
	}
	srv := newServer(st, static, nil)
	var now int64 = 1000
	srv.now = func() int64 { return now }
	hs := httptest.NewServer(srv)
	t.Cleanup(hs.Close)
	return hs, srv
}

func postJSON(t *testing.T, url string, body any) (int, map[string]any) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.Post(url, "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]any{}
	if len(bytes.TrimSpace(b)) > 0 && bytes.Contains(bytes.TrimSpace(b), []byte("{")) {
		if err := json.Unmarshal(b, &out); err != nil {
			t.Fatalf("json %s: %v", b, err)
		}
	}
	return res.StatusCode, out
}

func TestOptionsCORS(t *testing.T) {
	hs, _ := testServer(t)
	req, _ := http.NewRequest(http.MethodOptions, hs.URL+"/v1/pair/request", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", res.StatusCode)
	}
	if res.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("cors %q", res.Header.Get("Access-Control-Allow-Origin"))
	}
}

func TestRequestValidation(t *testing.T) {
	hs, _ := testServer(t)
	res, err := http.Post(hs.URL+"/v1/pair/request", "application/json", strings.NewReader("{"))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid json status %d", res.StatusCode)
	}
	code, body := postJSON(t, hs.URL+"/v1/pair/request", map[string]any{})
	if code != http.StatusBadRequest || body["error"] != "missing publicKey" {
		t.Fatalf("%d %#v", code, body)
	}
}

func TestPairHandshakeAndCredentialWindow(t *testing.T) {
	hs, srv := testServer(t)
	code, body := postJSON(t, hs.URL+"/v1/pair/request", map[string]any{"publicKey": "abc123"})
	if code != 200 || body["state"] != "requested" {
		t.Fatalf("request %#v", body)
	}
	pairID := body["pairId"].(string)
	if pairID != pairIDFromPublicKey("abc123") {
		t.Fatalf("pairId %s", pairID)
	}

	code, body = postJSON(t, hs.URL+"/v1/pair/claim", map[string]any{"publicKey": "abc123"})
	if code != http.StatusBadRequest || body["error"] != "missing boxedKey" {
		t.Fatalf("claim missing boxedKey %d %#v", code, body)
	}

	code, body = postJSON(t, hs.URL+"/v1/pair/claim", map[string]any{
		"publicKey":  "abc123",
		"boxedKey":   "boxed",
		"deviceName": "iphone",
	})
	if code != 200 || body["state"] != "authorized" || body["deviceToken"] == nil {
		t.Fatalf("claim %#v", body)
	}
	deviceToken := body["deviceToken"].(string)

	code, body = postJSON(t, hs.URL+"/v1/pair/request", map[string]any{"publicKey": "abc123"})
	if code != 200 || body["hostToken"] == nil || body["response"] != "boxed" || body["deviceName"] != "iphone" {
		t.Fatalf("credentials %#v", body)
	}
	hostToken := body["hostToken"].(string)

	code, body = postJSON(t, hs.URL+"/v1/pair/claim", map[string]any{
		"publicKey": "abc123",
		"boxedKey":  "other",
	})
	if code != http.StatusConflict || body["error"] != "already claimed" {
		t.Fatalf("second claim %d %#v", code, body)
	}

	srv.now = func() int64 { return 1000 + credentialWindowMS + 1 }
	code, body = postJSON(t, hs.URL+"/v1/pair/request", map[string]any{"publicKey": "abc123"})
	if code != 200 || body["state"] != "authorized" || body["hostToken"] != nil {
		t.Fatalf("closed window %#v", body)
	}

	req, _ := http.NewRequest(http.MethodDelete, hs.URL+"/v1/pair/"+pairID+"?token=nope", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("delete unauth %d", res.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodDelete, hs.URL+"/v1/pair/"+pairID+"?token="+deviceToken, nil)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("delete %d", res.StatusCode)
	}
	_ = hostToken
}

func TestClaimNoPending(t *testing.T) {
	hs, _ := testServer(t)
	code, body := postJSON(t, hs.URL+"/v1/pair/claim", map[string]any{
		"publicKey": "nobody",
		"boxedKey":  "boxed",
	})
	if code != http.StatusConflict || body["error"] != "no pending pair" {
		t.Fatalf("%d %#v", code, body)
	}
}

func TestHTTPClaimExpired(t *testing.T) {
	hs, srv := testServer(t)
	postJSON(t, hs.URL+"/v1/pair/request", map[string]any{"publicKey": "abc123"})
	srv.now = func() int64 { return 1000 + pairTTLMS + 1 }
	code, body := postJSON(t, hs.URL+"/v1/pair/claim", map[string]any{
		"publicKey": "abc123",
		"boxedKey":  "boxed",
	})
	if code != http.StatusConflict || body["error"] != "pair code expired" {
		t.Fatalf("%d %#v", code, body)
	}
}

func TestStaticIndex(t *testing.T) {
	hs, _ := testServer(t)
	res, err := http.Get(hs.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || !bytes.Contains(b, []byte("小满")) {
		t.Fatalf("index %d %s", res.StatusCode, b)
	}
	res, err = http.Get(hs.URL + "/not-a-real-route")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("spa fallback %d", res.StatusCode)
	}
}

func pairRoom(t *testing.T) (hs *httptest.Server, pairID, hostToken, deviceToken string) {
	t.Helper()
	hs, _ = testServer(t)
	postJSON(t, hs.URL+"/v1/pair/request", map[string]any{"publicKey": "abc123"})
	_, claimBody := postJSON(t, hs.URL+"/v1/pair/claim", map[string]any{
		"publicKey":  "abc123",
		"boxedKey":   "boxed",
		"deviceName": "phone",
	})
	_, reqBody := postJSON(t, hs.URL+"/v1/pair/request", map[string]any{"publicKey": "abc123"})
	return hs, reqBody["pairId"].(string), reqBody["hostToken"].(string), claimBody["deviceToken"].(string)
}

func dialWS(t *testing.T, hs *httptest.Server, pairID, role, token string) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(hs.URL, "http") + "/v1/pair/" + pairID + "?role=" + role + "&token=" + token
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func readJSONType(t *testing.T, conn *websocket.Conn, timeout time.Duration) string {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var msg struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("ws json %s: %v", data, err)
	}
	return msg.Type
}

func TestWSRevokedHandshake(t *testing.T) {
	hs, pairID, _, _ := pairRoom(t)
	u := "ws" + strings.TrimPrefix(hs.URL, "http") + "/v1/pair/" + pairID + "?role=host&token=nope"
	conn, res, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if res.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status %d", res.StatusCode)
	}
	_, _, err = conn.ReadMessage()
	ce, ok := err.(*websocket.CloseError)
	if !ok || ce.Code != websocket.ClosePolicyViolation {
		t.Fatalf("close %v", err)
	}
	if ce.Text != "revoked" {
		t.Fatalf("reason %q", ce.Text)
	}
}

func TestWSBadRole(t *testing.T) {
	hs, pairID, hostToken, _ := pairRoom(t)
	u := "ws" + strings.TrimPrefix(hs.URL, "http") + "/v1/pair/" + pairID + "?role=other&token=" + hostToken
	_, res, err := websocket.DefaultDialer.Dial(u, nil)
	if err == nil {
		t.Fatal("expected reject")
	}
	if res == nil || res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %#v %v", res, err)
	}
}

func TestWSPingPongAndForward(t *testing.T) {
	hs, pairID, hostToken, deviceToken := pairRoom(t)
	guest := dialWS(t, hs, pairID, roleGuest, deviceToken)
	if got := readJSONType(t, guest, time.Second); got != "host-offline" {
		t.Fatalf("guest first %s", got)
	}
	host := dialWS(t, hs, pairID, roleHost, hostToken)
	if got := readJSONType(t, guest, time.Second); got != "host-online" {
		t.Fatalf("guest host-online %s", got)
	}
	if got := readJSONType(t, host, time.Second); got != "peer-joined" {
		t.Fatalf("host peer-joined %s", got)
	}

	if err := host.WriteMessage(websocket.TextMessage, []byte("ping")); err != nil {
		t.Fatal(err)
	}
	_ = host.SetReadDeadline(time.Now().Add(time.Second))
	mt, data, err := host.ReadMessage()
	if err != nil || mt != websocket.TextMessage || string(data) != "pong" {
		t.Fatalf("pong %d %q %v", mt, data, err)
	}
	time.Sleep(30 * time.Millisecond)
	if err := host.WriteMessage(websocket.TextMessage, []byte(`{"enc":1}`)); err != nil {
		t.Fatal(err)
	}
	_ = guest.SetReadDeadline(time.Now().Add(time.Second))
	mt, data, err = guest.ReadMessage()
	if err != nil || mt != websocket.TextMessage || string(data) != `{"enc":1}` {
		t.Fatalf("forward %d %q %v", mt, data, err)
	}

	if err := guest.WriteMessage(websocket.BinaryMessage, []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	_ = host.SetReadDeadline(time.Now().Add(time.Second))
	mt, data, err = host.ReadMessage()
	if err != nil || mt != websocket.BinaryMessage || string(data) != "\x01\x02\x03" {
		t.Fatalf("binary %d %q %v", mt, data, err)
	}
}

func TestWSReplaceDoesNotBroadcastOffline(t *testing.T) {
	hs, pairID, hostToken, deviceToken := pairRoom(t)
	guest := dialWS(t, hs, pairID, roleGuest, deviceToken)
	_ = readJSONType(t, guest, time.Second) // host-offline
	host1 := dialWS(t, hs, pairID, roleHost, hostToken)
	_ = readJSONType(t, guest, time.Second) // host-online
	_ = readJSONType(t, host1, time.Second) // peer-joined

	host2 := dialWS(t, hs, pairID, roleHost, hostToken)
	_, _, err := host1.ReadMessage()
	ce, ok := err.(*websocket.CloseError)
	if !ok || ce.Code != websocket.CloseNormalClosure {
		t.Fatalf("replaced close %v", err)
	}
	if got := readJSONType(t, guest, time.Second); got != "host-online" {
		t.Fatalf("guest after replace %s", got)
	}
	if got := readJSONType(t, host2, time.Second); got != "peer-joined" {
		t.Fatalf("new host %s", got)
	}
	if err := host2.WriteMessage(websocket.TextMessage, []byte("still")); err != nil {
		t.Fatal(err)
	}
	_ = guest.SetReadDeadline(time.Now().Add(time.Second))
	_, data, err := guest.ReadMessage()
	if err != nil || string(data) != "still" {
		t.Fatalf("new host forward %q %v", data, err)
	}
}

func TestWSRevokeFrame(t *testing.T) {
	hs, pairID, hostToken, deviceToken := pairRoom(t)
	guest := dialWS(t, hs, pairID, roleGuest, deviceToken)
	_ = readJSONType(t, guest, time.Second)
	host := dialWS(t, hs, pairID, roleHost, hostToken)
	_ = readJSONType(t, guest, time.Second)
	_ = readJSONType(t, host, time.Second)

	req, _ := http.NewRequest(http.MethodDelete, hs.URL+"/v1/pair/"+pairID+"?token="+hostToken, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("delete %d", res.StatusCode)
	}
	if got := readJSONType(t, guest, time.Second); got != "revoked" {
		t.Fatalf("guest %s", got)
	}
	if got := readJSONType(t, host, time.Second); got != "revoked" {
		t.Fatalf("host %s", got)
	}
	_, _, err = guest.ReadMessage()
	ce, ok := err.(*websocket.CloseError)
	if !ok || ce.Code != websocket.ClosePolicyViolation {
		t.Fatalf("guest close %v", err)
	}
}

func TestWSPeerLeft(t *testing.T) {
	hs, pairID, hostToken, deviceToken := pairRoom(t)
	guest := dialWS(t, hs, pairID, roleGuest, deviceToken)
	_ = readJSONType(t, guest, time.Second)
	host := dialWS(t, hs, pairID, roleHost, hostToken)
	_ = readJSONType(t, guest, time.Second)
	_ = readJSONType(t, host, time.Second)
	_ = guest.Close()
	if got := readJSONType(t, host, time.Second); got != "peer-left" {
		t.Fatalf("host %s", got)
	}
}
