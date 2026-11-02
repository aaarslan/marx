package engine

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCredentialReplacementReleasesOnlySupersededKeys(t *testing.T) {
	f := fixture(t)
	var forgotten [][]byte
	f.e.host.ForgetCredential = func(blob []byte) error { forgotten = append(forgotten, append([]byte{}, blob...)); return nil }
	f.e.host.CredentialAvailable = func() bool { return true }
	if _, err := f.e.setKey("first-disposable-key"); err != nil {
		t.Fatal(err)
	}
	old, err := os.ReadFile(filepath.Join(f.profile, "settings.key"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.e.setKey("replacement-disposable-key"); err != nil {
		t.Fatal(err)
	}
	current, err := os.ReadFile(filepath.Join(f.profile, "settings.key"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(old, current) || len(forgotten) != 1 || !bytes.Equal(forgotten[0], old) {
		t.Fatal("Replacement deleted the wrong encryption key")
	}
	if _, err = f.e.setKey(""); err != nil {
		t.Fatal(err)
	}
	if len(forgotten) != 2 || !bytes.Equal(forgotten[1], current) {
		t.Fatal("Removal left the current encryption key behind")
	}
	if boolean(f.e.getSettings()["hasStoredApiKey"]) {
		t.Fatal("Removed key still appears stored")
	}
}

func TestCredentialEncryptionFailurePreservesSavedKey(t *testing.T) {
	f := fixture(t)
	if _, err := f.e.setKey("original-disposable-key"); err != nil {
		t.Fatal(err)
	}
	old, _ := os.ReadFile(filepath.Join(f.profile, "settings.key"))
	f.e.host.Protect = func(string, []byte) ([]byte, error) { return nil, errors.New("Synthetic encryption denial") }
	forgotten := false
	f.e.host.ForgetCredential = func([]byte) error { forgotten = true; return nil }
	if _, err := f.e.setKey("replacement"); err == nil {
		t.Fatal("Encryption failure was ignored")
	}
	current, _ := os.ReadFile(filepath.Join(f.profile, "settings.key"))
	if forgotten || !bytes.Equal(old, current) {
		t.Fatal("Failed replacement changed the saved credential")
	}
}

func TestFailedCredentialPersistenceReleasesNewKey(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("Requires Unix directory permissions")
	}
	f := fixture(t)
	if _, err := f.e.setKey("original-disposable-key"); err != nil {
		t.Fatal(err)
	}
	old, _ := os.ReadFile(filepath.Join(f.profile, "settings.key"))
	var forgotten []byte
	f.e.host.ForgetCredential = func(blob []byte) error { forgotten = append([]byte{}, blob...); return nil }
	if err := os.Chmod(f.profile, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(f.profile, 0700) })
	if _, err := f.e.setKey("replacement-disposable-key"); err == nil {
		t.Fatal("Read-only profile accepted a replacement")
	}
	current, _ := os.ReadFile(filepath.Join(f.profile, "settings.key"))
	if !bytes.Equal(old, current) || !bytes.Equal(forgotten, []byte("protected:replacement-disposable-key")) {
		t.Fatal("Persistence failure lost the original key or leaked the replacement")
	}
}

func TestCredentialAvailabilityDoesNotEncrypt(t *testing.T) {
	f := fixture(t)
	f.e.host.CredentialAvailable = func() bool { return true }
	f.e.host.Protect = func(string, []byte) ([]byte, error) {
		t.Fatal("Availability probe attempted credential encryption")
		return nil, nil
	}
	if !boolean(f.e.getSettings()["credentialStorageAvailable"]) {
		t.Fatal("OS storage availability was lost")
	}
	f.e.host.CredentialAvailable = nil
	if boolean(f.e.getSettings()["credentialStorageAvailable"]) {
		t.Fatal("Missing storage availability probe did not fail closed")
	}
}
