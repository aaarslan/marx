package main

import (
	"errors"
	"fmt"
	"io"
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

type processJob windows.Handle

func nativeDownloadsDirectory() (string, error) {
	return windows.KnownFolderPath(windows.FOLDERID_Downloads, 0)
}

func (j processJob) Close() error { return windows.CloseHandle(windows.Handle(j)) }
func containProcess(cmd *exec.Cmd) (io.Closer, error) {
	if cmd.SysProcAttr == nil || cmd.SysProcAttr.CreationFlags&windows.CREATE_SUSPENDED == 0 {
		return nil, errors.New("The CLI must start suspended before job assignment")
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	_, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)))
	if err != nil {
		windows.CloseHandle(job)
		return nil, err
	}
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		windows.CloseHandle(job)
		return nil, err
	}
	defer windows.CloseHandle(process)
	if err = windows.AssignProcessToJobObject(job, process); err != nil {
		windows.CloseHandle(job)
		return nil, err
	}
	if err = resumeContainedProcess(uint32(cmd.Process.Pid)); err != nil {
		windows.CloseHandle(job)
		return nil, err
	}
	return processJob(job), nil
}
func protectCredential(mode string, value []byte) ([]byte, error) {
	if len(value) == 0 || len(value) > 2<<20 || mode == "protect" && len(value) > 1<<20 {
		return nil, errors.New("Credential input rejected.")
	}
	in := windows.DataBlob{Size: uint32(len(value)), Data: &value[0]}
	out := windows.DataBlob{}
	var err error
	switch mode {
	case "protect":
		err = windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	case "unprotect":
		err = windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	default:
		return nil, errors.New("Unsupported credential operation.")
	}
	if err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(out.Data))))
	return append([]byte(nil), unsafe.Slice(out.Data, int(out.Size))...), nil
}

func credentialProtector(profile string) func(string, []byte) ([]byte, error) {
	return protectCredential
}
func runProcessGuard() bool { return false }

func resumeContainedProcess(pid uint32) error {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ThreadEntry32{Size: uint32(unsafe.Sizeof(windows.ThreadEntry32{}))}
	err = windows.Thread32First(snapshot, &entry)
	var threadID uint32
	for count := 0; err == nil && count < 100000; count++ {
		if entry.OwnerProcessID == pid {
			if threadID != 0 {
				return errors.New("The suspended CLI has more than one thread")
			}
			threadID = entry.ThreadID
		}
		err = windows.Thread32Next(snapshot, &entry)
	}
	if err == nil {
		return errors.New("CLI thread enumeration exceeded its limit")
	}
	if err != windows.ERROR_NO_MORE_FILES {
		return fmt.Errorf("CLI thread enumeration failed: %w", err)
	}
	if threadID == 0 {
		return errors.New("The suspended CLI thread was not found")
	}
	thread, err := windows.OpenThread(windows.THREAD_SUSPEND_RESUME|windows.THREAD_QUERY_LIMITED_INFORMATION, false, threadID)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(thread)
	owner, _, queryErr := getThreadProcessID.Call(uintptr(thread))
	if owner == 0 {
		return fmt.Errorf("The CLI thread owner could not be verified: %w", queryErr)
	}
	if uint32(owner) != pid {
		return errors.New("CLI thread identity changed before resumption")
	}
	count, err := windows.ResumeThread(thread)
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("The CLI thread was not suspended exactly once")
	}
	return nil
}

func credentialStorageAvailable() bool {
	_, err := protectCredential("protect", []byte("storage-check"))
	return err == nil
}
func credentialDeleter(profile string) func([]byte) error { return nil }

var getThreadProcessID = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetProcessIdOfThread")
