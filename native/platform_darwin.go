package main

/*
#cgo CFLAGS: -mmacosx-version-min=13.0
#cgo LDFLAGS: -mmacosx-version-min=13.0 -framework LocalAuthentication -framework Security -framework CoreFoundation
#include "credential_darwin.h"
*/
import "C"

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

func nativeDownloadsDirectory() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, "Downloads"), err
}

var credentialAccessOnce sync.Once
var credentialAccessErr error

func configureCredentialAccess() error {
	credentialAccessOnce.Do(func() {
		if C.marxDisableCredentialInteraction() != 0 {
			credentialAccessErr = errors.New("macOS Keychain noninteractive access could not be configured")
		}
	})
	return credentialAccessErr
}

var credentialEnvelope = []byte("MARXKEY2")

func nativeCredentialAccount(profile string, blob []byte) (string, []byte, error) {
	identity := sha256.Sum256([]byte(profile))
	account := hex.EncodeToString(identity[:])
	if !bytes.HasPrefix(blob, credentialEnvelope) {
		return account, identity[:], nil
	}
	if len(blob) < len(credentialEnvelope)+16+12+16 {
		return "", nil, errors.New("Invalid protected credential")
	}
	header := blob[:len(credentialEnvelope)+16]
	return account + "." + hex.EncodeToString(header[len(credentialEnvelope):]), append(identity[:], header...), nil
}
func readCredentialKey(account string) ([]byte, error) {
	if err := configureCredentialAccess(); err != nil {
		return nil, err
	}
	name := C.CString(account)
	defer C.free(unsafe.Pointer(name))
	key := make([]byte, 32)
	if C.marxReadCredentialKey(name, (*C.uchar)(unsafe.Pointer(&key[0]))) != 0 {
		return nil, errors.New("The saved key is unavailable in macOS Keychain; replace it in Settings or use CLI configuration")
	}
	return key, nil
}
func storeCredentialKey(account string, key []byte) error {
	if err := configureCredentialAccess(); err != nil {
		return err
	}
	if len(key) == 0 {
		return errors.New("Empty Keychain value")
	}
	name := C.CString(account)
	defer C.free(unsafe.Pointer(name))
	if C.marxStoreCredentialKey(name, (*C.uchar)(unsafe.Pointer(&key[0])), C.int(len(key))) != 0 {
		return errors.New("macOS Keychain could not save a new encryption key")
	}
	return nil
}
func removeCredentialKey(account string) error {
	if err := configureCredentialAccess(); err != nil {
		return err
	}
	name := C.CString(account)
	defer C.free(unsafe.Pointer(name))
	status := C.marxDeleteCredentialKey(name)
	if status != 0 && status != -25300 {
		return errors.New("The previous macOS Keychain entry could not be removed")
	}
	return nil
}
func credentialStorageAvailable() bool {
	return configureCredentialAccess() == nil && C.marxCredentialStorageStatus() == 0
}
func credentialDeleter(profile string) func([]byte) error {
	return func(blob []byte) error {
		if len(blob) == 0 {
			return nil
		}
		account, _, err := nativeCredentialAccount(profile, blob)
		if err != nil {
			return err
		}
		return removeCredentialKey(account)
	}
}
func credentialProtector(profile string) func(string, []byte) ([]byte, error) {
	return func(mode string, value []byte) ([]byte, error) {
		if mode != "protect" && mode != "unprotect" {
			return nil, errors.New("Unsupported credential operation")
		}
		if len(value) == 0 || len(value) > 2<<20 || mode == "protect" && len(value) > 1<<20 {
			return nil, errors.New("Credential input rejected")
		}
		var key, header, aad []byte
		var account string
		var err error
		if mode == "protect" {
			reference := make([]byte, 16)
			key = make([]byte, 32)
			if _, err = rand.Read(reference); err != nil {
				return nil, err
			}
			if _, err = rand.Read(key); err != nil {
				return nil, err
			}
			header = append(append([]byte{}, credentialEnvelope...), reference...)
			identity := sha256.Sum256([]byte(profile))
			account = hex.EncodeToString(identity[:]) + "." + hex.EncodeToString(reference)
			aad = append(identity[:], header...)
		} else {
			account, aad, err = nativeCredentialAccount(profile, value)
			if err != nil {
				return nil, err
			}
			key, err = readCredentialKey(account)
			if err != nil {
				return nil, err
			}
			if bytes.HasPrefix(value, credentialEnvelope) {
				value = value[len(credentialEnvelope)+16:]
			}
		}
		defer func() {
			for i := range key {
				key[i] = 0
			}
		}()
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		if mode == "protect" {
			nonce := make([]byte, aead.NonceSize())
			if _, err = rand.Read(nonce); err != nil {
				return nil, err
			}
			protected := append(header, aead.Seal(nonce, nonce, value, aad)...)
			if err = storeCredentialKey(account, key); err != nil {
				return nil, err
			}
			return protected, nil
		}
		if len(value) < aead.NonceSize() {
			return nil, errors.New("Invalid protected credential")
		}
		return aead.Open(nil, value[:aead.NonceSize()], value[aead.NonceSize():], aad)
	}
}

type processGuard struct {
	pipe    *os.File
	command *exec.Cmd
}

func (g *processGuard) Close() error {
	err := g.pipe.Close()
	g.command.Wait()
	return err
}
func containProcess(cmd *exec.Cmd) (io.Closer, error) {
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	readyRead, readyWrite, err := os.Pipe()
	if err != nil {
		writer.Close()
		return nil, err
	}
	defer readyRead.Close()
	defer readyWrite.Close()
	executable, err := os.Executable()
	if err != nil {
		writer.Close()
		return nil, err
	}
	guard := exec.Command(executable, "--marx-process-guard", strconv.Itoa(cmd.Process.Pid))
	guard.Stdin = reader
	guard.Stdout = readyWrite
	if err := guard.Start(); err != nil {
		writer.Close()
		return nil, err
	}
	readyWrite.Close()
	readyRead.SetReadDeadline(time.Now().Add(5 * time.Second))
	ready := make([]byte, 1)
	if _, err := io.ReadFull(readyRead, ready); err != nil || ready[0] != 1 {
		writer.Close()
		guard.Process.Kill()
		guard.Wait()
		syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		return nil, errors.New("CLI process guard did not start")
	}
	return &processGuard{writer, guard}, nil
}
func runProcessGuard() bool {
	if len(os.Args) != 3 || os.Args[1] != "--marx-process-guard" {
		return false
	}
	pid, err := strconv.Atoi(os.Args[2])
	if err != nil || pid <= 1 {
		os.Exit(1)
	}
	if _, err := os.Stdout.Write([]byte{1}); err != nil {
		syscall.Kill(-pid, syscall.SIGKILL)
		os.Exit(1)
	}
	os.Stdout.Close()
	io.Copy(io.Discard, os.Stdin)
	syscall.Kill(-pid, syscall.SIGKILL)
	return true
}
