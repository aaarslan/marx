//go:build acceptance

package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"os"
)

func browserOptions() application.WindowsOptions {
	return application.WindowsOptions{WndClass: "MarxWailsAcceptanceWindow", AdditionalBrowserArgs: []string{"--remote-debugging-port=" + os.Getenv("MARX_ACCEPTANCE_PORT")}}
}
