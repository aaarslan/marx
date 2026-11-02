package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type intelTransport func(*http.Request) (*http.Response, error)

func (f intelTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func intelResponse(status int, value any) *http.Response {
	data, _ := json.Marshal(value)
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(string(data)))}
}
func intelFixture(t *testing.T) (*Engine, *atomic.Int32) {
	f := fixture(t)
	e := f.e
	at := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	e.intel.clock = func() time.Time { return at }
	calls := &atomic.Int32{}
	e.intel.client = &http.Client{Transport: intelTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("Credentials entered a public intelligence request")
		}
		switch r.URL.Host {
		case "raw.githubusercontent.com":
			return intelResponse(200, Object{"catalogVersion": "2026.11.01", "count": 1, "vulnerabilities": []Object{{"cveID": "CVE-2021-44228", "dateAdded": "2021-12-10", "dueDate": "2021-12-24", "requiredAction": "Apply vendor mitigation", "knownRansomwareCampaignUse": "Known"}}}), nil
		case "api.first.org":
			rows := []Object{}
			for _, id := range strings.Split(r.URL.Query().Get("cve"), ",") {
				rows = append(rows, Object{"cve": id, "epss": "0.02", "percentile": "0.6", "date": "2026-11-01"})
			}
			return intelResponse(200, Object{"status": "OK", "total": len(rows), "offset": 0, "data": rows}), nil
		case "cveawg.mitre.org":
			id := strings.TrimPrefix(r.URL.Path, "/api/cve/")
			return intelResponse(200, Object{"cveMetadata": Object{"cveId": id, "state": "PUBLISHED"}, "containers": Object{"cna": Object{"title": "Synthetic advisory", "providerMetadata": Object{"shortName": "Synthetic CNA"}, "metrics": []Object{{"cvssV3_1": Object{"baseScore": 8.1, "version": "3.1", "vectorString": "CVSS:3.1/AV:N"}}}, "references": []Object{{"url": "https://example.invalid/advisory", "tags": []string{"exploit"}}}}}}), nil
		}
		t.Error("Unexpected intelligence destination")
		return intelResponse(500, Object{}), nil
	})}
	return e, calls
}
func enableIntel(t *testing.T, e *Engine, sources ...string) {
	t.Helper()
	if _, err := e.intel.configure(Object{"enabledSources": sources}); err != nil {
		t.Fatal(err)
	}
}
func refreshIntel(t *testing.T, e *Engine, ids ...string) Object {
	t.Helper()
	value, err := e.intel.refresh(Object{"cves": ids, "requestId": uuid(), "force": true})
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func TestIntelligenceRequiresOptInAndOnlyAcceptsExactCVEs(t *testing.T) {
	e, calls := intelFixture(t)
	if _, err := e.intel.refresh(Object{"cves": []string{"CVE-2021-44228"}, "requestId": "disabled"}); err == nil {
		t.Fatal("Disabled sources made a request")
	}
	cached, err := e.intel.get([]string{"CVE-2021-44228"})
	if err != nil {
		t.Fatal(err)
	}
	if str(observation(object(cached["CVE-2021-44228"]), "epss"), "state") != "disabled" || calls.Load() != 0 {
		t.Fatal("Cached lookup accessed the network")
	}
	enableIntel(t, e, "epss")
	for _, value := range []any{[]string{"CWE-79"}, []string{"https://example.invalid"}, []any{7}, []string{"CVE-2021-44228\nsecret"}} {
		if _, err := e.intel.refresh(Object{"cves": value, "requestId": uuid()}); err == nil {
			t.Fatal("Invalid CVE input was accepted")
		}
	}
	if calls.Load() != 0 {
		t.Fatal("Invalid identifiers reached a provider")
	}
	if _, err := e.intel.configure(Object{"enabledSources": []string{"https://example.invalid"}}); err == nil {
		t.Fatal("Arbitrary provider was accepted")
	}
}
func TestIntelligenceBatchRetainsSourcesAndDistinguishesKEVAbsence(t *testing.T) {
	e, calls := intelFixture(t)
	enableIntel(t, e, "kev", "epss", "cve")
	result := refreshIntel(t, e, "CVE-2021-44228", "CVE-2024-1234", "CVE-2024-1234")
	if calls.Load() != 4 {
		t.Fatalf("Expected one catalog, one EPSS batch and two CVE lookups, got %d", calls.Load())
	}
	first, second := object(result["CVE-2021-44228"]), object(result["CVE-2024-1234"])
	if !boolean(object(observation(first, "kev")["value"])["listed"]) || boolean(object(observation(second, "kev")["value"])["listed"]) {
		t.Fatal("KEV membership was lost")
	}
	if number(object(observation(first, "epss")["value"])["probability"]) != 0.02 || len(objects(object(observation(first, "cve")["value"])["references"])) != 1 {
		t.Fatal("Source evidence was lost")
	}
	before := calls.Load()
	if _, err := e.intel.get([]string{"CVE-2021-44228"}); err != nil || calls.Load() != before {
		t.Fatal("Reading cached evidence made a request")
	}
}
func TestIntelligenceFailurePreservesCachedPositiveEvidence(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "kev", "epss")
	refreshIntel(t, e, "CVE-2021-44228")
	e.intel.client.Transport = intelTransport(func(r *http.Request) (*http.Response, error) {
		response := intelResponse(429, Object{})
		response.Header.Set("Retry-After", "120")
		return response, nil
	})
	result := refreshIntel(t, e, "CVE-2021-44228")
	snapshot := object(result["CVE-2021-44228"])
	for _, source := range []string{"kev", "epss"} {
		obs := observation(snapshot, source)
		if str(obs, "state") != "stale" || obs["value"] == nil || str(obs, "error") == "" {
			t.Fatal("Failed refresh erased evidence or treated it as fresh")
		}
	}
	if !boolean(object(observation(snapshot, "kev")["value"])["listed"]) {
		t.Fatal("Known exploitation was silently cleared")
	}
}
func TestMissingEPSSIsUnavailableRatherThanZero(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "epss")
	e.intel.client.Transport = intelTransport(func(*http.Request) (*http.Response, error) {
		return intelResponse(200, Object{"status": "OK", "total": 0, "offset": 0, "data": []Object{}}), nil
	})
	result := refreshIntel(t, e, "CVE-2024-1234")
	obs := observation(object(result["CVE-2024-1234"]), "epss")
	if str(obs, "state") != "unavailable" || obs["value"] != nil {
		t.Fatal("Missing score became a numeric zero")
	}
}
func TestIntelligenceRejectsPartialAndInvalidProviderResponses(t *testing.T) {
	for _, name := range []string{"partial", "duplicate", "mismatch", "range", "future"} {
		t.Run(name, func(t *testing.T) {
			e, _ := intelFixture(t)
			enableIntel(t, e, "epss")
			e.intel.client.Transport = intelTransport(func(*http.Request) (*http.Response, error) {
				row := Object{"cve": "CVE-2024-1234", "epss": "0.1", "percentile": "0.5", "date": "2026-11-01"}
				rows := []Object{row}
				total := 1
				switch name {
				case "partial":
					total = 2
				case "duplicate":
					rows = append(rows, row)
					total = 2
				case "mismatch":
					row["cve"] = "CVE-2020-1111"
				case "range":
					row["epss"] = "2"
				case "future":
					row["date"] = "2026-11-02"
				}
				return intelResponse(200, Object{"status": "OK", "total": total, "offset": 0, "data": rows}), nil
			})
			result := refreshIntel(t, e, "CVE-2024-1234")
			if str(observation(object(result["CVE-2024-1234"]), "epss"), "state") != "unavailable" {
				t.Fatal("Invalid provider evidence was accepted")
			}
		})
	}
}
func TestIntelligenceCancellationAndOverload(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "epss")
	entered := make(chan struct{})
	e.intel.client.Transport = intelTransport(func(r *http.Request) (*http.Response, error) {
		close(entered)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	done := make(chan error, 1)
	go func() {
		_, err := e.intel.refresh(Object{"cves": []string{"CVE-2024-1234"}, "requestId": "running"})
		done <- err
	}()
	<-entered
	if _, err := e.intel.refresh(Object{"cves": []string{"CVE-2024-1234"}, "requestId": "duplicate"}); err == nil {
		t.Fatal("Concurrent duplicate refresh was queued")
	}
	e.intel.cancel("running")
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Canceled refresh succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("Cancellation did not reach the HTTP request")
	}
	e.intel.cancel("early")
	if _, err := e.intel.refresh(Object{"cves": []string{"CVE-2024-1234"}, "requestId": "early"}); err == nil {
		t.Fatal("Early cancellation was lost")
	}
}
func TestDisablingSourcesCancelsActiveRequests(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "epss")
	entered := make(chan struct{})
	e.intel.client.Transport = intelTransport(func(r *http.Request) (*http.Response, error) {
		close(entered)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	done := make(chan error, 1)
	go func() {
		_, err := e.intel.refresh(Object{"cves": []string{"CVE-2024-1234"}, "requestId": "disable"})
		done <- err
	}()
	<-entered
	enableIntel(t, e)
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Disabled request completed")
		}
	case <-time.After(time.Second):
		t.Fatal("Source disable did not cancel pending work")
	}
}
func TestIntelligenceFreshnessUsesScoreDateAndRetainsZero(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "epss")
	e.intel.client.Transport = intelTransport(func(*http.Request) (*http.Response, error) {
		return intelResponse(200, Object{"status": "OK", "total": 1, "offset": 0, "data": []Object{{"cve": "CVE-2024-1234", "epss": "0", "percentile": "0", "date": "2026-10-28"}}}), nil
	})
	snapshot := object(refreshIntel(t, e, "CVE-2024-1234")["CVE-2024-1234"])
	obs := observation(snapshot, "epss")
	if str(obs, "state") != "stale" || object(obs["value"])["probability"] == nil {
		t.Fatal("Old score was marked fresh or zero was lost")
	}
}
func decisionFixture(t *testing.T, e *Engine) Object {
	t.Helper()
	client, err := e.client()
	if err != nil {
		t.Fatal(err)
	}
	f := Object{"id": "intel-finding", "vendorId": "intel-vendor", "connectionId": client.connection, "scanId": "intel-scan", "projectId": "p1", "type": "sca", "cve": "CVE-2024-1234", "title": "Synthetic package vulnerability", "severity": "HIGH", "state": "TO_VERIFY", "packageName": "synthetic-package", "packageVersion": "1.0.0", "packageManager": "npm"}
	page := Object{"connectionId": client.connection, "scan": Object{"id": "intel-scan", "projectId": "p1", "projectName": "Synthetic project"}, "findings": []Object{f}, "totalCount": 1}
	if err = e.store.saveSnapshot(client.connection, page); err != nil {
		t.Fatal(err)
	}
	return Object{"connectionId": client.connection, "scanId": "intel-scan", "findingId": "intel-finding", "expectedRevision": 0, "verdict": "defer", "note": "Synthetic documented review", "reviewAt": "2026-12-01", "assumptions": Object{"notInKev": true, "epssBelow": 0.1, "manual": "Not internet-facing; requires human review"}}
}
func TestDecisionHistoryScopeAndPinnedEvidence(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "kev", "epss")
	refreshIntel(t, e, "CVE-2024-1234")
	input := decisionFixture(t, e)
	decision, err := e.recordDecision(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.recordDecision(input); err == nil {
		t.Fatal("A stale revision overwrote the saved decision")
	}
	id := str(decision, "id")
	connection := str(decision, "connectionId")
	before := jsonValue(decision["evidence"])
	cache, _ := e.store.get("intel-cache", "", "CVE-2024-1234")
	for _, source := range objects(cache["sources"]) {
		if str(source, "source") == "kev" {
			source["value"] = Object{"listed": true}
		}
	}
	if err = e.store.save(record{kind: "intel-cache", id: "CVE-2024-1234", value: cache}); err != nil {
		t.Fatal(err)
	}
	values, err := e.decisions()
	if err != nil || len(values) != 1 || str(values[0], "reviewState") != "needs_review" {
		t.Fatal("Broken exploitation assumption was not flagged")
	}
	if string(jsonValue(values[0]["evidence"])) != string(before) {
		t.Fatal("Intelligence refresh rewrote pinned evidence")
	}
	history, err := e.decisionHistory(id)
	if err != nil || len(history) != 1 {
		t.Fatal("Decision history was lost")
	}
	stored, _ := e.store.get("snapshot", connection, "intel-scan")
	if str(objects(stored["findings"])[0], "state") != "TO_VERIFY" {
		t.Fatal("Local decision changed scanner state")
	}
	input["expectedRevision"] = 1
	input["verdict"] = "patch_now"
	input["assumptions"] = Object{"manual": "Review after patch"}
	revised, err := e.recordDecision(input)
	if err != nil || number(revised["revision"]) != 2 {
		t.Fatal("Re-deciding failed", err)
	}
	history, _ = e.decisionHistory(id)
	if len(history) != 2 {
		t.Fatal("Re-deciding replaced history")
	}
	if _, err = e.closeDecision(Object{"id": id, "expectedRevision": 1, "reason": "Stale closure"}); err == nil {
		t.Fatal("Stale closure overwrote a newer decision")
	}
	closed, err := e.closeDecision(Object{"id": id, "expectedRevision": 2, "reason": "Documented closure, not a verified fix"})
	if err != nil || str(closed, "reviewState") != "closed" {
		t.Fatal("Closure failed", err)
	}
}
func TestDecisionsDoNotTreatUnavailableEvidenceAsValid(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "kev", "epss")
	refreshIntel(t, e, "CVE-2024-1234")
	decision, err := e.recordDecision(decisionFixture(t, e))
	if err != nil {
		t.Fatal(err)
	}
	enableIntel(t, e)
	if str(e.reviewDecision(decision), "reviewState") != "unavailable" {
		t.Fatal("Disabled evidence validated an assumption")
	}
	e.intel.clock = func() time.Time { return time.Date(2026, 12, 2, 0, 0, 0, 0, time.UTC) }
	if str(e.reviewDecision(decision), "reviewState") != "review_due" {
		t.Fatal("Expired review date was ignored")
	}
}
func TestProviderBoundsAndReferenceSafety(t *testing.T) {
	e, _ := intelFixture(t)
	if _, err := e.intel.readJSON(context.Background(), "https://example.invalid/path", 1024); err == nil {
		t.Fatal("Arbitrary destination was allowed")
	}
	e.intel.client.Transport = intelTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", 1025)))}, nil
	})
	if _, err := e.intel.readJSON(context.Background(), "https://api.first.org/", 1024); err == nil {
		t.Fatal("Oversized response was accepted")
	}
	for _, value := range []string{"http://example.invalid/exploit", "file:///private/data", "https://user:password@example.invalid/"} {
		if safeIntelURL(value) != "" {
			t.Fatal("Unsafe reference was accepted")
		}
	}
	for _, count := range []int{0, 2} {
		if _, err := parseKEV(Object{"catalogVersion": "fixture", "count": count, "vulnerabilities": []Object{{"cveID": "CVE-2024-1234", "dateAdded": "2026-01-01", "dueDate": "2026-01-15"}}}); err == nil {
			t.Fatal("Partial catalog was accepted")
		}
	}
}
func TestWatchlistRecordsChangesAndKeepsFirstObservationSilent(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "epss")
	if _, err := e.intel.watch(Object{"cve": "CVE-2024-1234"}, false); err != nil {
		t.Fatal(err)
	}
	refreshIntel(t, e, "CVE-2024-1234")
	watch, _ := e.intel.watchlist()
	if len(objects(watch["events"])) != 0 {
		t.Fatal("First observation was not a silent baseline")
	}
	e.intel.client.Transport = intelTransport(func(*http.Request) (*http.Response, error) {
		return intelResponse(200, Object{"status": "OK", "total": 1, "offset": 0, "data": []Object{{"cve": "CVE-2024-1234", "epss": "0.3", "percentile": "0.9", "date": "2026-11-01"}}}), nil
	})
	refreshIntel(t, e, "CVE-2024-1234")
	watch, _ = e.intel.watchlist()
	if len(objects(watch["events"])) != 1 {
		t.Fatal("Watch change was not recorded")
	}
	if _, err := e.intel.watch(Object{"cve": "CVE-2024-1234"}, true); err != nil {
		t.Fatal(err)
	}
	watch, _ = e.intel.watchlist()
	if len(objects(watch["items"])) != 0 || len(objects(watch["events"])) != 1 {
		t.Fatal("Unwatch erased historical evidence")
	}
}
func TestIntelligenceSessionEvidenceIsPinned(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "epss")
	refreshIntel(t, e, "CVE-2024-1234")
	decisionFixture(t, e)
	session, err := e.createSession(context.Background(), Object{"title": "Synthetic intel session", "scanId": "intel-scan", "findingIds": []string{"intel-finding"}})
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := e.bundle(str(session, "id"))
	if err != nil {
		t.Fatal(err)
	}
	pinned := fmt.Sprint(object(bundle["intelligence"])["CVE-2024-1234"])
	if err = e.store.remove("intel-cache", "", "CVE-2024-1234"); err != nil {
		t.Fatal(err)
	}
	bundle, err = e.bundle(str(session, "id"))
	if err != nil || fmt.Sprint(object(bundle["intelligence"])["CVE-2024-1234"]) != pinned {
		t.Fatal("Session lost its original intelligence snapshot")
	}
}

func TestBrokenDecisionAssumptionsStayFlaggedUntilRevised(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "kev", "epss")
	refreshIntel(t, e, "CVE-2024-1234")
	input := decisionFixture(t, e)
	decision, err := e.recordDecision(input)
	if err != nil {
		t.Fatal(err)
	}
	original := e.intel.client.Transport
	e.intel.client.Transport = intelTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "api.first.org" {
			return intelResponse(200, Object{"status": "OK", "total": 1, "offset": 0, "data": []Object{{"cve": "CVE-2024-1234", "epss": "0.2", "percentile": "0.9", "date": "2026-11-01"}}}), nil
		}
		return original.RoundTrip(r)
	})
	refreshIntel(t, e, "CVE-2024-1234")
	e.intel.client.Transport = original
	refreshIntel(t, e, "CVE-2024-1234")
	values, err := e.decisions()
	if err != nil || str(values[0], "reviewState") != "needs_review" {
		t.Fatal("A previously broken assumption silently became valid again")
	}
	history, err := e.decisionHistory(str(decision, "id"))
	if err != nil || history[0]["reviewAlert"] == nil {
		t.Fatal("The evidence that triggered review was not retained")
	}
	if err = e.intel.clearCache(); err != nil {
		t.Fatal(err)
	}
	values, _ = e.decisions()
	if str(values[0], "reviewState") != "needs_review" {
		t.Fatal("Clearing fetched data cleared the review alert")
	}
	history, _ = e.decisionHistory(str(decision, "id"))
	if history[0]["evidence"] == nil || history[0]["reviewAlert"] == nil {
		t.Fatal("Cache cleanup erased decision evidence")
	}
}
func TestDecisionRejectsChangedConnectionAndUnsupportedAssumptions(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "epss")
	refreshIntel(t, e, "CVE-2024-1234")
	input := decisionFixture(t, e)
	input["connectionId"] = "different-connection"
	if _, err := e.recordDecision(input); err == nil {
		t.Fatal("A decision was recorded across a connection change")
	}
	input = decisionFixture(t, e)
	if _, err := e.recordDecision(input); err == nil {
		t.Fatal("Disabled KEV evidence supported a negative assumption")
	}
}

func TestCancellationOverflowCannotAdmitAnAlreadyCanceledRequest(t *testing.T) {
	e, calls := intelFixture(t)
	enableIntel(t, e, "epss")
	for index := 0; index < 130; index++ {
		e.intel.cancel(fmt.Sprintf("early-%d", index))
	}
	if _, err := e.intel.refresh(Object{"cves": []string{"CVE-2024-1234"}, "requestId": "early-129"}); err == nil {
		t.Fatal("Cancellation overflow allowed work to start")
	}
	if calls.Load() != 0 {
		t.Fatal("Canceled work reached a provider")
	}
}

func TestCacheAndReviewAlertCommitAtomically(t *testing.T) {
	e, _ := intelFixture(t)
	enableIntel(t, e, "kev", "epss")
	refreshIntel(t, e, "CVE-2024-1234")
	if _, err := e.recordDecision(decisionFixture(t, e)); err != nil {
		t.Fatal(err)
	}
	if _, err := e.store.db.Exec("CREATE TRIGGER reject_intel_alert BEFORE INSERT ON records WHEN NEW.kind='intel-decision-alert' BEGIN SELECT RAISE(ABORT,'synthetic persistence failure'); END"); err != nil {
		t.Fatal(err)
	}
	e.intel.client.Transport = intelTransport(func(*http.Request) (*http.Response, error) {
		return intelResponse(200, Object{"status": "OK", "total": 1, "offset": 0, "data": []Object{{"cve": "CVE-2024-1234", "epss": "0.2", "percentile": "0.9", "date": "2026-11-01"}}}), nil
	})
	if _, err := e.intel.refresh(Object{"cves": []string{"CVE-2024-1234"}, "requestId": "atomic-failure", "force": true}); err == nil {
		t.Fatal("Persistence failure was reported as success")
	}
	cache, err := e.store.get("intel-cache", "", "CVE-2024-1234")
	if err != nil {
		t.Fatal(err)
	}
	if number(object(observation(cache, "epss")["value"])["probability"]) != 0.02 {
		t.Fatal("New evidence committed without its required review trigger")
	}
}
func TestPublicSourceRedirectCannotReachAnotherHost(t *testing.T) {
	e, _ := intelFixture(t)
	client := defaultIntelligenceHTTPClient()
	var calls atomic.Int32
	client.Transport = intelTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		response := intelResponse(302, Object{})
		response.Header.Set("Location", "https://example.invalid/redirected")
		return response, nil
	})
	e.intel.client = client
	if _, err := e.intel.readJSON(context.Background(), "https://api.first.org/data/v1/epss", 1024); err == nil {
		t.Fatal("Source redirect was followed")
	}
	if calls.Load() != 1 {
		t.Fatal("A redirect escaped the provider boundary")
	}
}
