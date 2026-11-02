//go:build !acceptance

package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"net/http"
)

func browserOptions() application.WindowsOptions {
	return application.WindowsOptions{WndClass: "MarxWailsWindow"}
}

func acceptanceAssets(next http.Handler) http.Handler { return next }
func startAcceptance(win *application.WebviewWindow)  {}
