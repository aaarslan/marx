package main

/*
#cgo CFLAGS: -mmacosx-version-min=13.0
#cgo LDFLAGS: -mmacosx-version-min=13.0 -framework LocalAuthentication -framework Security -framework CoreFoundation
#include "credential_darwin.h"
*/
import "C"

import (
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
	"syscall"
	"time"
	"unsafe"
)

func nativeDownloadsDirectory() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, "Downloads"), err
}

func credentialProtector(profile string) func(string, []byte) ([]byte, error) {
	identity := sha256.Sum256([]byte(profile))
	return func(mode string, value []byte) ([]byte, error) {
		if len(value) == 0 || len(value) > 2<<20 || mode == "protect" && len(value) > 1<<20 {
			return nil, errors.New("Credential input rejected")
		}
		account := C.CString(hex.EncodeToString(identity[:]))
		defer C.free(unsafe.Pointer(account))
		key := make([]byte, 32)
		defer func() {
			for i := range key {
				key[i] = 0
			}
		}()
		status := C.marxCredentialKey(account, (*C.uchar)(unsafe.Pointer(&key[0])))
		if status != 0 {
			return nil, errors.New("macOS Keychain is unavailable")
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		switch mode {
		case "protect":
			nonce := make([]byte, aead.NonceSize())
			if _, err := rand.Read(nonce); err != nil {
				return nil, err
			}
			return aead.Seal(nonce, nonce, value, identity[:]), nil
		case "unprotect":
			if len(value) < aead.NonceSize() {
				return nil, errors.New("Invalid protected credential")
			}
			return aead.Open(nil, value[:aead.NonceSize()], value[aead.NonceSize():], identity[:])
		default:
			return nil, errors.New("Unsupported credential operation")
		}
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

func deleteCredentialStorage(profile string) {
	identity := sha256.Sum256([]byte(profile))
	account := C.CString(hex.EncodeToString(identity[:]))
	defer C.free(unsafe.Pointer(account))
	C.marxDeleteCredentialKey(account)
}
