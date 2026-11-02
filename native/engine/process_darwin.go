package engine

import (
	"errors"
	"io"
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

func prepareProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
}

func prepareGuardedProcess(cmd *exec.Cmd) (func() error, func(), error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, nil, err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, nil, err
	}
	gateFD := 3 + len(cmd.ExtraFiles)
	cmd.ExtraFiles = append(cmd.ExtraFiles, reader)
	cmd.Args = append([]string{executable, "--marx-cli-launch", strconv.Itoa(gateFD), cmd.Path}, cmd.Args[1:]...)
	cmd.Path = executable
	return func() error {
		_, err := writer.Write([]byte{1})
		writer.Close()
		return err
	}, func() { reader.Close(); writer.Close() }, nil
}

func RunGuardedCLI() bool {
	if len(os.Args) < 4 || os.Args[1] != "--marx-cli-launch" {
		return false
	}
	fd, err := strconv.Atoi(os.Args[2])
	if err != nil || fd < 3 {
		os.Exit(1)
	}
	gate := os.NewFile(uintptr(fd), "CLI launch gate")
	ready := make([]byte, 1)
	_, err = io.ReadFull(gate, ready)
	gate.Close()
	if err == nil && ready[0] == 1 {
		err = syscall.Exec(os.Args[3], os.Args[3:], os.Environ())
	}
	if err == nil {
		err = errors.New("CLI launch was not authorized")
	}
	os.Stderr.WriteString(err.Error() + "\n")
	os.Exit(1)
	return true
}
