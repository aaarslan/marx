package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsContainmentFixture(t *testing.T) {
	mode := os.Getenv("MARX_CONTAINMENT_FIXTURE")
	if mode == "" {
		return
	}
	root := os.Getenv("MARX_CONTAINMENT_ROOT")
	if mode == "child" {
		if err := os.WriteFile(filepath.Join(root, "child"), []byte(strconv.Itoa(os.Getpid())), 0600); err != nil {
			os.Exit(2)
		}
		time.Sleep(time.Minute)
		return
	}
	executable, err := os.Executable()
	if err != nil {
		os.Exit(2)
	}
	if err = os.WriteFile(filepath.Join(root, "parent"), []byte("started"), 0600); err != nil {
		os.Exit(2)
	}
	child := exec.Command(executable, "-test.run=^TestWindowsContainmentFixture$")
	child.Env = append(os.Environ(), "MARX_CONTAINMENT_FIXTURE=child")
	if err = child.Run(); err != nil {
		os.Exit(2)
	}
}

func TestWindowsCLIStartsInsideJobBeforeSpawningChildren(t *testing.T) {
	root := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, "-test.run=^TestWindowsContainmentFixture$")
	cmd.Env = append(os.Environ(), "MARX_CONTAINMENT_FIXTURE=parent", "MARX_CONTAINMENT_ROOT="+root)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_SUSPENDED}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	time.Sleep(50 * time.Millisecond)
	if _, err = os.Stat(filepath.Join(root, "parent")); !os.IsNotExist(err) {
		t.Fatal("CLI executed before job assignment")
	}
	guard, err := containProcess(cmd)
	if err != nil {
		cmd.Process.Kill()
		cmd.Wait()
		t.Fatal(err)
	}
	defer func() {
		if guard != nil {
			guard.Close()
		}
	}()
	var pid int
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		data, readErr := os.ReadFile(filepath.Join(root, "child"))
		if readErr == nil {
			pid, _ = strconv.Atoi(string(data))
			if pid > 0 {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	if pid == 0 {
		t.Fatal("The assigned CLI did not resume and spawn its child")
	}
	child, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(child)
	parent, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(cmd.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(parent)
	for _, handle := range []windows.Handle{parent, child} {
		if result, waitErr := windows.WaitForSingleObject(handle, 0); waitErr != nil || result != uint32(windows.WAIT_TIMEOUT) {
			t.Fatal("The containment fixture exited before job cleanup")
		}
	}
	err = guard.Close()
	guard = nil
	if err != nil {
		t.Fatal(err)
	}
	if result, waitErr := windows.WaitForSingleObject(parent, 5000); waitErr != nil || result != windows.WAIT_OBJECT_0 {
		t.Fatal("Closing the job left the parent alive")
	}
	cmd.Wait()
	result, err := windows.WaitForSingleObject(child, 5000)
	if err != nil || result != windows.WAIT_OBJECT_0 {
		t.Fatal("A CLI descendant escaped job cleanup")
	}
}
