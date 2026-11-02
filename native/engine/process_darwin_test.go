package engine

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestDarwinCLILaunchRequiresContainmentRelease(t *testing.T) {
	for _, releaseCLI := range []bool{false, true} {
		t.Run(strconv.FormatBool(releaseCLI), func(t *testing.T) {
			root := t.TempDir()
			source := filepath.Join(root, "source")
			if err := os.Mkdir(source, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source, "index.js"), []byte("synthetic"), 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, fixtureExecutable, "scan", "create", "--file-source="+source)
			cmd.Env = append(os.Environ(), "MARX_FIXTURE_ROOT="+root)
			prepareProcess(cmd)
			release, closeGate, err := prepareGuardedProcess(cmd)
			if err != nil {
				t.Fatal(err)
			}
			defer closeGate()
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer cmd.Process.Kill()
			time.Sleep(100 * time.Millisecond)
			marker := filepath.Join(root, "submissionPID")
			if _, err := os.Stat(marker); !os.IsNotExist(err) {
				t.Fatal("CLI executed before containment released its launch gate")
			}
			if releaseCLI {
				if err := release(); err != nil {
					t.Fatal(err)
				}
			} else {
				closeGate()
			}
			err = cmd.Wait()
			if !releaseCLI {
				if err == nil {
					t.Fatal("An abandoned launch gate succeeded")
				}
				if _, err := os.Stat(marker); !os.IsNotExist(err) {
					t.Fatal("CLI executed after its owner's launch pipe closed")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			pid, err := os.ReadFile(marker)
			if err != nil || string(pid) != strconv.Itoa(cmd.Process.Pid) {
				t.Fatal("Released CLI did not retain the protected process identity")
			}
		})
	}
}
