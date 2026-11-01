//go:build acceptance && windows

package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"net/http"
	"os"
)

func browserOptions() application.WindowsOptions {
	return application.WindowsOptions{WndClass: "MarxWailsAcceptanceWindow", AdditionalBrowserArgs: []string{"--remote-debugging-port=" + os.Getenv("MARX_ACCEPTANCE_PORT")}}
}

func acceptanceAssets(next http.Handler) http.Handler { return next }
func startAcceptance(win *application.WebviewWindow) {
	if os.Getenv("MARX_ACCEPTANCE_MINIMUM_SIZE") == "1" {
		win.SetSize(960, 640)
	}
}
