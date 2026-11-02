//go:build acceptance

package engine

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type syntheticIntelligenceTransport struct {
	root  string
	valid bool
}

func intelligenceHTTPClient() (*http.Client, bool) {
	if os.Getenv("MARX_INTEL_FIXTURE") != "1" {
		return defaultIntelligenceHTTPClient(), false
	}
	root := os.Getenv("MARX_FIXTURE_ROOT")
	profile := os.Getenv("MARX_USER_DATA_DIR")
	root, err := filepath.Abs(root)
	relative, relErr := filepath.Rel(root, profile)
	_, markerErr := os.Stat(filepath.Join(root, ".synthetic-marx-fixture"))
	valid := err == nil && relErr == nil && markerErr == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && root != filepath.VolumeName(root)+string(filepath.Separator)
	return &http.Client{Transport: syntheticIntelligenceTransport{root: root, valid: valid}, Timeout: 15 * time.Second}, true
}
func (s syntheticIntelligenceTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if !s.valid {
		return nil, errors.New("Synthetic intelligence requires an isolated marked fixture profile")
	}
	if _, err := os.Stat(filepath.Join(s.root, "intel-hold")); err == nil {
		select {
		case <-request.Context().Done():
			return nil, context.Canceled
		case <-time.After(20 * time.Second):
			return nil, errors.New("Synthetic delay completed")
		}
	}
	_, escalated := os.Stat(filepath.Join(s.root, "intel-escalate"))
	changed := escalated == nil
	var value Object
	switch request.URL.Host {
	case "raw.githubusercontent.com":
		entries := []Object{{"cveID": "CVE-2021-44228", "vendorProject": "Synthetic vendor", "product": "Synthetic component", "dateAdded": "2021-12-10", "dueDate": "2021-12-24", "requiredAction": "Apply a compatible vendor fix and verify the affected path.", "knownRansomwareCampaignUse": "Known"}}
		if changed {
			entries = append(entries, Object{"cveID": "CVE-2024-1234", "vendorProject": "Synthetic vendor", "product": "Synthetic package", "dateAdded": time.Now().UTC().Format("2006-01-02"), "dueDate": time.Now().Add(14 * 24 * time.Hour).UTC().Format("2006-01-02"), "requiredAction": "Review the newly documented exploitation and prioritize a verified fix.", "knownRansomwareCampaignUse": "Unknown"})
		}
		value = Object{"catalogVersion": "synthetic-v1", "count": len(entries), "vulnerabilities": entries}
	case "api.first.org":
		rows := []Object{}
		for _, cve := range strings.Split(request.URL.Query().Get("cve"), ",") {
			probability := "0.0200"
			if changed {
				probability = "0.4200"
			}
			if cve == "CVE-2021-44228" {
				probability = "0.9700"
			}
			rows = append(rows, Object{"cve": cve, "epss": probability, "percentile": "0.9900", "date": time.Now().UTC().Format("2006-01-02")})
		}
		value = Object{"status": "OK", "total": len(rows), "offset": 0, "data": rows}
	case "cveawg.mitre.org":
		cve := strings.TrimPrefix(request.URL.Path, "/api/cve/")
		refs := []Object{{"url": "https://example.invalid/synthetic-advisory", "name": "Synthetic vendor advisory", "tags": []string{"vendor-advisory"}}}
		if changed || cve == "CVE-2021-44228" {
			refs = append(refs, Object{"url": "https://example.invalid/synthetic-exploit-reference", "name": "Synthetic exploit reference — not executable evidence", "tags": []string{"exploit"}})
		}
		value = Object{"cveMetadata": Object{"cveId": cve, "state": "PUBLISHED", "dateUpdated": time.Now().UTC().Format(time.RFC3339)}, "containers": Object{"cna": Object{"title": "Synthetic dependency vulnerability", "providerMetadata": Object{"shortName": "Synthetic CNA"}, "metrics": []Object{{"cvssV3_1": Object{"baseScore": 8.1, "version": "3.1", "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N"}}}, "references": refs}}}
	default:
		return nil, errors.New("Synthetic intelligence destination is unsupported")
	}
	data, _ := json.Marshal(value)
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(string(data)))}, nil
}
