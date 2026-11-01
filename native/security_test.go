package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFramesCannotReachNativeRuntime(t *testing.T) {
	for _, destination := range []string{"iframe", "frame"} {
		called := false
		handler := secureAssets(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
		request := httptest.NewRequest("POST", "http://wails.localhost/wails/runtime", nil)
		request.Header.Set("Sec-Fetch-Dest", destination)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if called || response.Code != http.StatusForbidden {
			t.Fatal("Embedded content reached the native endpoint")
		}
		if response.Header().Get("X-Frame-Options") != "DENY" {
			t.Fatal("Frame protection missing")
		}
	}
}
func TestProtectedCredentialRoundTrip(t *testing.T) {
	profile := t.TempDir()
	protectCredential := credentialProtector(profile)
	original := []byte("disposable-native-test")
	protected, err := protectCredential("protect", original)
	if err != nil {
		t.Fatal("Protected credential encryption failed")
	}
	if forget := credentialDeleter(profile); forget != nil {
		t.Cleanup(func() { _ = forget(protected) })
	}
	if bytes.Contains(protected, original) {
		t.Fatal("Plaintext credential was stored")
	}
	restored, err := protectCredential("unprotect", protected)
	if err != nil || !bytes.Equal(original, restored) {
		t.Fatal("Protected credential round-trip failed")
	}
	if _, err = protectCredential("unprotect", []byte("unprotected data")); err == nil {
		t.Fatal("Unprotected credentials were accepted")
	}
}

func TestConcurrentNativeDialogIsRejected(t *testing.T) {
	s := &DesktopService{}
	s.dialogMu.Lock()
	defer s.dialogMu.Unlock()
	if _, err := s.native("open", nil); err == nil {
		t.Fatal("Repeated native dialog was not rejected")
	}
}

func TestMaximumCredentialRoundTrip(t *testing.T) {
	profile := t.TempDir()
	protect := credentialProtector(profile)
	original := bytes.Repeat([]byte("x"), 1<<20)
	blob, err := protect("protect", original)
	if err != nil {
		t.Fatal(err)
	}
	if forget := credentialDeleter(profile); forget != nil {
		t.Cleanup(func() { _ = forget(blob) })
	}
	restored, err := protect("unprotect", blob)
	if err != nil || !bytes.Equal(original, restored) {
		t.Fatal("The maximum supported credential could not be restored")
	}
}
