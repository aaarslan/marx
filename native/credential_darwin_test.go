package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"testing"
)

func TestKeychainReplacementRecoversFromMalformedEntry(t *testing.T) {
	profile := t.TempDir()
	legacyAccount, _, _ := nativeCredentialAccount(profile, nil)
	if err := storeCredentialKey(legacyAccount, []byte("invalid")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = removeCredentialKey(legacyAccount) })
	protect := credentialProtector(profile)
	if _, err := protect("unprotect", make([]byte, 40)); err == nil {
		t.Fatal("Malformed legacy encryption key was accepted")
	}
	if !credentialStorageAvailable() {
		t.Fatal("Malformed saved key disabled credential recovery")
	}
	value := []byte("replacement-disposable-key")
	blob, err := protect("protect", value)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = credentialDeleter(profile)(blob) })
	if !bytes.HasPrefix(blob, credentialEnvelope) || bytes.Contains(blob, value) {
		t.Fatal("Replacement was not protected with its own key")
	}
	restored, err := protect("unprotect", blob)
	if err != nil || !bytes.Equal(value, restored) {
		t.Fatal("Replacement key could not be used")
	}
	account, _, _ := nativeCredentialAccount(profile, blob)
	if err = removeCredentialKey(account); err != nil {
		t.Fatal(err)
	}
	if _, err = protect("unprotect", blob); err == nil {
		t.Fatal("Missing Keychain entry was silently recreated")
	}
	if _, err = readCredentialKey(account); err == nil {
		t.Fatal("Decryption mutated Keychain")
	}
	replacement, err := protect("protect", value)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = credentialDeleter(profile)(replacement) })
	if bytes.Equal(blob, replacement) {
		t.Fatal("Replacement reused a missing encryption key")
	}
}

func TestLegacyKeychainCredentialsRemainReadable(t *testing.T) {
	profile := t.TempDir()
	account, aad, _ := nativeCredentialAccount(profile, nil)
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	if err := storeCredentialKey(account, key); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = removeCredentialKey(account) })
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	value := []byte("legacy-disposable-key")
	blob := aead.Seal(nonce, nonce, value, aad)
	restored, err := credentialProtector(profile)("unprotect", blob)
	if err != nil || !bytes.Equal(value, restored) {
		t.Fatal("Existing credential compatibility was lost")
	}
}

func TestCredentialEnvelopeRejectsTamperingAndOtherProfiles(t *testing.T) {
	profile := t.TempDir()
	protect := credentialProtector(profile)
	blob, err := protect("protect", []byte("disposable-secret"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = credentialDeleter(profile)(blob) })
	tampered := append([]byte{}, blob...)
	tampered[len(tampered)-1] ^= 1
	if _, err = protect("unprotect", tampered); err == nil {
		t.Fatal("Modified ciphertext was accepted")
	}
	if _, err = credentialProtector(t.TempDir())("unprotect", blob); err == nil {
		t.Fatal("Another profile could decrypt the saved credential")
	}
}
