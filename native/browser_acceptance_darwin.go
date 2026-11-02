//go:build acceptance

package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var acceptanceState = struct {
	sync.Mutex
	pending map[string]chan json.RawMessage
	token   string
}{pending: map[string]chan json.RawMessage{}, token: os.Getenv("MARX_ACCEPTANCE_TOKEN")}

func browserOptions() application.WindowsOptions { return application.WindowsOptions{} }
func acceptanceAssets(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__marx_acceptance_result" {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "Method rejected", 405)
			return
		}
		var result struct {
			ID     string          `json:"id"`
			Result json.RawMessage `json:"result"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<20)).Decode(&result) != nil {
			http.Error(w, "Invalid result", 400)
			return
		}
		acceptanceState.Lock()
		channel := acceptanceState.pending[result.ID]
		delete(acceptanceState.pending, result.ID)
		acceptanceState.Unlock()
		if channel != nil {
			channel <- result.Result
		}
		w.WriteHeader(204)
	})
}
func startAcceptance(win *application.WebviewWindow) {
	if os.Getenv("MARX_ACCEPTANCE_MINIMUM_SIZE") == "1" {
		win.SetSize(960, 640)
	}
	port := os.Getenv("MARX_ACCEPTANCE_PORT")
	if port == "" || acceptanceState.token == "" {
		return
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", port))
	if err != nil {
		panic(err)
	}
	slots := make(chan struct{}, 4)
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 65 * time.Second, IdleTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+acceptanceState.token || r.Header.Get("Origin") != "" {
			http.Error(w, "Unauthorized", 401)
			return
		}
		if r.URL.Path == "/ready" {
			w.WriteHeader(204)
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/evaluate" {
			http.Error(w, "Not found", 404)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			http.Error(w, "Busy", 429)
			return
		}
		var request struct {
			Expression string `json:"expression"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&request) != nil {
			http.Error(w, "Invalid expression", 400)
			return
		}
		idBytes := make([]byte, 16)
		if _, err := rand.Read(idBytes); err != nil {
			http.Error(w, "Entropy unavailable", 500)
			return
		}
		id := hex.EncodeToString(idBytes)
		result := make(chan json.RawMessage, 1)
		acceptanceState.Lock()
		acceptanceState.pending[id] = result
		acceptanceState.Unlock()
		defer func() { acceptanceState.Lock(); delete(acceptanceState.pending, id); acceptanceState.Unlock() }()
		expression := request.Expression
		win.ExecJS(fmt.Sprintf(`(async()=>{let result;try{result={value:await (%s)}}catch(error){result={error:String(error)}}await fetch('/__marx_acceptance_result',{method:'POST',body:JSON.stringify({id:%q,result})})})()`, expression, id))
		select {
		case value := <-result:
			w.Header().Set("Content-Type", "application/json")
			w.Write(value)
		case <-r.Context().Done():
		case <-time.After(60 * time.Second):
			http.Error(w, "Evaluation timed out", 504)
		}
	})}
	go func() {
		if err := server.Serve(listener); err != nil && !strings.Contains(err.Error(), "Server closed") {
			fmt.Fprintln(os.Stderr, "Acceptance transport stopped")
		}
	}()
}
