package main

import (
	"errors"
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
	return processJob(job), nil
}
func protectCredential(mode string, value []byte) ([]byte, error) {
	if len(value) == 0 || len(value) > 1024*1024 {
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

func deleteCredentialStorage(profile string) {}
