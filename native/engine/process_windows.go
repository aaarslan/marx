package engine

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

func prepareProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }

func prepareGuardedProcess(cmd *exec.Cmd) (func() error, func(), error) {
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_SUSPENDED
	return func() error { return nil }, func() {}, nil
}

func RunGuardedCLI() bool { return false }
