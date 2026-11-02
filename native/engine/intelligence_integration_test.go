//go:build integration

package engine

import (
	"os"
	"testing"
)

func TestPublicCVEIntelligenceSources(t *testing.T) {
	if os.Getenv("MARX_VERIFY_PUBLIC_INTEL") != "1" {
		t.Skip("Explicit public-source network verification is required")
	}
	e, err := Open(t.TempDir(), Host{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err = e.intel.configure(Object{"enabledSources": []string{"kev", "epss", "cve"}}); err != nil {
		t.Fatal(err)
	}
	result, err := e.intel.refresh(Object{"cves": []string{"CVE-2021-44228"}, "requestId": "public-source-verification", "force": true})
	if err != nil {
		t.Fatal(err)
	}
	value := object(result["CVE-2021-44228"])
	for _, source := range objects(value["sources"]) {
		if str(source, "state") != "fresh" {
			t.Errorf("Public source %s was %s: %s", str(source, "source"), str(source, "state"), str(source, "error"))
		}
	}
	if !boolean(object(observation(value, "kev")["value"])["listed"]) {
		t.Fatal("The public known-exploited CVE was not found in the complete CISA catalog")
	}
	if object(observation(value, "epss")["value"])["probability"] == nil {
		t.Fatal("FIRST returned no usable probability")
	}
	if str(object(observation(value, "cve")["value"]), "recordState") != "PUBLISHED" {
		t.Fatal("CVE.org returned no published record")
	}
}
