//go:build !acceptance

package engine

import "net/http"

func intelligenceHTTPClient() (*http.Client, bool) { return defaultIntelligenceHTTPClient(), false }
