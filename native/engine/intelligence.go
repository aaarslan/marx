package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand/v2"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var cvePattern = regexp.MustCompile(`^CVE-(1999|20[0-9]{2})-[0-9]{4,19}$`)
var intelProviders = []Object{
	{"id": "kev", "name": "CISA KEV", "host": "raw.githubusercontent.com/cisagov/kev-data", "description": "Downloads CISA's complete known-exploited catalog from its official GitHub mirror. No finding identifiers are sent."},
	{"id": "epss", "name": "FIRST EPSS", "host": "api.first.org", "description": "Sends only the requested CVE IDs to FIRST for exploitation probability and percentile. No source, paths, tenant details or credentials are sent."},
	{"id": "cve", "name": "CVE.org", "host": "cveawg.mitre.org", "description": "Sends only CVE IDs for CNA and CISA context, scores and exploit-tagged reference links. References are displayed, never fetched or executed."},
}

const kevURL = "https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json"

type Intelligence struct {
	cancellationBarrier time.Time
	commitSnapshot      func(Object) error
	synthetic           bool
	store               *Store
	parent              context.Context
	mu                  sync.Mutex
	refreshMu           sync.Mutex
	runs                map[string]context.CancelFunc
	canceled            map[string]time.Time
	generation          uint64
	client              *http.Client
	clock               func() time.Time
}

func defaultIntelligenceHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxConnsPerHost = 3
	transport.MaxIdleConnsPerHost = 3
	return &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Intelligence redirects are disabled") }}
}
func newIntelligence(ctx context.Context, store *Store) *Intelligence {
	client, synthetic := intelligenceHTTPClient()
	return &Intelligence{store: store, parent: ctx, runs: map[string]context.CancelFunc{}, canceled: map[string]time.Time{}, clock: time.Now, client: client, synthetic: synthetic}
}
func normalizeCVE(value string) (string, error) {
	id := strings.ToUpper(strings.TrimSpace(value))
	if !cvePattern.MatchString(id) {
		return "", errors.New("Enter a complete CVE ID, such as CVE-2021-44228")
	}
	return id, nil
}
func intelIDs(raw any, maximum int) ([]string, error) {
	values := stringsOf(raw)
	if len(values) != len(array(raw)) || len(values) > maximum {
		return nil, fmt.Errorf("Choose at most %d CVE IDs", maximum)
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		id, err := normalizeCVE(value)
		if err != nil {
			return nil, err
		}
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	return ids, nil
}
func (i *Intelligence) settings() (Object, error) {
	saved, err := i.store.get("intel-settings", "", "default")
	if err != nil {
		return nil, err
	}
	enabled := stringsOf(saved["enabledSources"])
	if enabled == nil {
		enabled = []string{}
	}
	return Object{"enabledSources": enabled, "providers": intelProviders}, nil
}
func (i *Intelligence) configure(input Object) (Object, error) {
	enabled := stringsOf(input["enabledSources"])
	if len(enabled) != len(array(input["enabledSources"])) || len(enabled) > 3 {
		return nil, errors.New("Invalid intelligence source selection")
	}
	seen := map[string]bool{}
	for _, source := range enabled {
		if !contains([]string{"kev", "epss", "cve"}, source) || seen[source] {
			return nil, errors.New("Choose supported intelligence sources")
		}
		seen[source] = true
	}
	i.mu.Lock()
	err := i.store.save(record{kind: "intel-settings", id: "default", value: Object{"enabledSources": enabled}})
	if err == nil {
		i.generation++
		for _, cancel := range i.runs {
			cancel()
		}
	}
	i.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return i.settings()
}
func (i *Intelligence) cancel(id string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if cancel := i.runs[id]; cancel != nil {
		cancel()
		return
	}
	for key, at := range i.canceled {
		if i.clock().Sub(at) > 2*time.Minute {
			delete(i.canceled, key)
		}
	}
	if len(id) > 0 && len(id) <= 128 {
		if len(i.canceled) < 128 {
			i.canceled[id] = i.clock()
		} else {
			i.cancellationBarrier = i.clock().Add(2 * time.Minute)
		}
	}
}
func (i *Intelligence) get(raw any) (Object, error) {
	ids, err := intelIDs(raw, 5000)
	if err != nil {
		return nil, err
	}
	settings, err := i.settings()
	if err != nil {
		return nil, err
	}
	enabled := stringsOf(settings["enabledSources"])
	result := Object{}
	for _, id := range ids {
		saved, err := i.store.get("intel-cache", "", id)
		if err != nil {
			return nil, err
		}
		if saved != nil && str(saved, "cve") != id {
			return nil, errors.New("Cached intelligence identity is invalid; existing data was preserved")
		}
		if saved == nil {
			saved = Object{"cve": id, "sources": []Object{}}
		}
		sources := []Object{}
		for _, provider := range intelProviders {
			source := str(provider, "id")
			observation := Object{"source": source, "state": "not_checked", "value": nil}
			for _, item := range objects(saved["sources"]) {
				if str(item, "source") == source {
					observation = clone(item)
					break
				}
			}
			if !contains(enabled, source) {
				observation["state"] = "disabled"
			} else if str(observation, "state") == "fresh" && number(observation["expiresAt"]) <= float64(i.clock().UnixMilli()) {
				observation["state"] = "stale"
			}
			sources = append(sources, observation)
		}
		saved["sources"] = sources
		if i.synthetic {
			saved["synthetic"] = true
		}
		result[id] = saved
	}
	return result, nil
}
func freshObservation(source string, value Object, at time.Time, ttl time.Duration) Object {
	return Object{"source": source, "state": "fresh", "value": value, "fetchedAt": at.UnixMilli(), "checkedAt": at.UnixMilli(), "expiresAt": at.Add(ttl).UnixMilli()}
}
func failedObservation(source string, previous Object, err error, at time.Time) Object {
	result := Object{"source": source, "state": "unavailable", "value": nil, "checkedAt": at.UnixMilli(), "error": err.Error()}
	if previous["value"] != nil {
		result = clone(previous)
		result["state"] = "stale"
		result["checkedAt"] = at.UnixMilli()
		result["error"] = err.Error()
	}
	return result
}
func observation(snapshot Object, source string) Object {
	for _, item := range objects(snapshot["sources"]) {
		if str(item, "source") == source {
			return item
		}
	}
	return Object{}
}
func (i *Intelligence) readJSON(ctx context.Context, target string, maximum int64) (Object, error) {
	parsed, err := url.Parse(target)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || !contains([]string{"raw.githubusercontent.com", "api.first.org", "cveawg.mitre.org"}, parsed.Host) {
		return nil, errors.New("Unsupported intelligence endpoint")
	}
	for attempt := 0; attempt < 2; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return nil, errors.New("Intelligence request is invalid")
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("User-Agent", "Marx CVE intelligence")
		response, err := i.client.Do(request)
		if err != nil {
			if ctx.Err() != nil {
				return nil, errors.New("Intelligence refresh was canceled or timed out")
			}
			return nil, errors.New("Intelligence source could not be reached")
		}
		if response.StatusCode == http.StatusOK {
			data, readErr := io.ReadAll(io.LimitReader(response.Body, maximum+1))
			response.Body.Close()
			if readErr != nil {
				return nil, errors.New("Intelligence response could not be read")
			}
			if int64(len(data)) > maximum {
				return nil, errors.New("Intelligence response exceeds its size limit")
			}
			var value Object
			if json.Unmarshal(data, &value) != nil || value == nil {
				return nil, errors.New("Intelligence source returned invalid JSON")
			}
			return value, nil
		}
		response.Body.Close()
		if response.StatusCode == 404 {
			return nil, errors.New("No published record was found")
		}
		transient := response.StatusCode == 429 || response.StatusCode == 502 || response.StatusCode == 503 || response.StatusCode == 504
		if transient && attempt == 0 {
			delay := time.Duration(250+rand.IntN(250)) * time.Millisecond
			if retry := response.Header.Get("Retry-After"); retry != "" {
				seconds, err := strconv.Atoi(retry)
				if err == nil {
					delay = time.Duration(seconds) * time.Second
				} else if date, err := http.ParseTime(retry); err == nil {
					delay = time.Until(date)
				} else {
					return nil, errors.New("Source retry guidance is unavailable; try again later")
				}
				if delay < 0 {
					delay = 0
				}
				if delay > 5*time.Second {
					return nil, errors.New("Source is rate limited or temporarily unavailable; try again later")
				}
			}
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, errors.New("Intelligence refresh was canceled or timed out")
			case <-timer.C:
				continue
			}
		}
		return nil, fmt.Errorf("Intelligence source returned HTTP %d", response.StatusCode)
	}
	return nil, errors.New("Intelligence source is unavailable")
}
func validDate(value string) bool { _, err := time.Parse("2006-01-02", value); return err == nil }
func shortIntel(value string, maximum int) string {
	if len(value) > maximum {
		return value[:maximum]
	}
	return value
}
func parseKEV(raw Object) (Object, error) {
	entries := array(raw["vulnerabilities"])
	if len(entries) == 0 || len(entries) > 20000 || number(raw["count"]) != float64(len(entries)) || (str(raw, "catalogVersion") == "" || len(str(raw, "catalogVersion")) > 100) {
		return nil, errors.New("CISA catalog is incomplete or invalid")
	}
	output := Object{}
	for _, entry := range entries {
		value := object(entry)
		id, err := normalizeCVE(str(value, "cveID"))
		if err != nil || output[id] != nil {
			return nil, errors.New("CISA catalog contains invalid or duplicate CVE IDs")
		}
		if !validDate(str(value, "dateAdded")) || !validDate(str(value, "dueDate")) {
			return nil, errors.New("CISA catalog contains invalid dates")
		}
		output[id] = Object{"listed": true, "vendor": shortIntel(str(value, "vendorProject"), 200), "product": shortIntel(str(value, "product"), 200), "dateAdded": str(value, "dateAdded"), "dueDate": str(value, "dueDate"), "action": shortIntel(str(value, "requiredAction"), 2000), "ransomware": str(value, "knownRansomwareCampaignUse"), "catalogVersion": str(raw, "catalogVersion")}
	}
	return output, nil
}
func (i *Intelligence) kev(ctx context.Context, force bool) (Object, error) {
	cached, err := i.store.get("intel-feed", "", "kev")
	if err != nil {
		return nil, err
	}
	if !force && str(cached, "state") == "fresh" && number(cached["expiresAt"]) > float64(i.clock().UnixMilli()) {
		return cached, nil
	}
	raw, err := i.readJSON(ctx, kevURL, 8<<20)
	if err != nil {
		return nil, err
	}
	entries, err := parseKEV(raw)
	if err != nil {
		return nil, err
	}
	value := freshObservation("kev", entries, i.clock(), 6*time.Hour)
	i.mu.Lock()
	defer i.mu.Unlock()
	if ctx.Err() != nil {
		return nil, errors.New("Intelligence refresh was canceled")
	}
	if err = i.store.save(record{kind: "intel-feed", id: "kev", value: value}); err != nil {
		return nil, err
	}
	return value, nil
}
func (i *Intelligence) epss(ctx context.Context, ids []string) (Object, error) {
	if len(strings.Join(ids, ",")) > 2000 {
		return nil, errors.New("EPSS query exceeds its identifier limit")
	}
	raw, err := i.readJSON(ctx, "https://api.first.org/data/v1/epss?limit=100&cve="+url.QueryEscape(strings.Join(ids, ",")), 1<<20)
	if err != nil {
		return nil, err
	}
	rows := array(raw["data"])
	if str(raw, "status") != "OK" || number(raw["total"]) != float64(len(rows)) || number(raw["offset"]) != 0 {
		return nil, errors.New("EPSS response is incomplete")
	}
	values := Object{}
	for _, row := range rows {
		entry := object(row)
		id := str(entry, "cve")
		if !contains(ids, id) || values[id] != nil {
			return nil, errors.New("EPSS returned unexpected or duplicate CVE IDs")
		}
		probability, pErr := strconv.ParseFloat(stringValue(entry["epss"]), 64)
		percentile, qErr := strconv.ParseFloat(stringValue(entry["percentile"]), 64)
		date, dateErr := time.Parse("2006-01-02", str(entry, "date"))
		if pErr != nil || qErr != nil || math.IsNaN(probability) || math.IsNaN(percentile) || math.IsInf(probability, 0) || math.IsInf(percentile, 0) || probability < 0 || probability > 1 || percentile < 0 || percentile > 1 || dateErr != nil || date.After(i.clock().UTC().Truncate(24*time.Hour)) {
			return nil, errors.New("EPSS returned invalid scores or dates")
		}
		obs := freshObservation("epss", Object{"probability": probability, "percentile": percentile, "date": str(entry, "date")}, i.clock(), time.Hour)
		obs["expiresAt"] = min(number(obs["expiresAt"]), float64(date.Add(48*time.Hour).UnixMilli()))
		if number(obs["expiresAt"]) <= float64(i.clock().UnixMilli()) {
			obs["state"] = "stale"
			obs["error"] = "The published EPSS score is out of date"
		}
		values[id] = obs
	}
	return values, nil
}
func safeIntelURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || len(raw) > 2048 {
		return ""
	}
	return raw
}
func parseCVE(raw Object, id string) (Object, error) {
	metadata := object(raw["cveMetadata"])
	if str(metadata, "cveId") != id || !contains([]string{"PUBLISHED", "REJECTED"}, str(metadata, "state")) {
		return nil, errors.New("CVE record identity or publication state is invalid")
	}
	containers := object(raw["containers"])
	cna := object(containers["cna"])
	result := Object{"recordState": str(metadata, "state"), "title": shortIntel(str(cna, "title"), 400), "updated": shortIntel(str(metadata, "dateUpdated"), 100), "scores": []Object{}, "references": []Object{}, "ssvc": []Object{}}
	scores, refs, ssvc := []Object{}, []Object{}, []Object{}
	sections := append([]Object{cna}, objects(containers["adp"])...)
	seen := map[string]bool{}
	for sectionIndex, section := range sections {
		if sectionIndex > 8 {
			break
		}
		provider := shortIntel(str(object(section["providerMetadata"]), "shortName"), 100)
		if provider == "" {
			provider = "CNA"
		}
		for metricIndex, metric := range objects(section["metrics"]) {
			if metricIndex >= 20 {
				break
			}
			for _, key := range []string{"cvssV4_0", "cvssV3_1", "cvssV3_0", "cvssV2_0"} {
				score := object(metric[key])
				value, ok := score["baseScore"].(float64)
				if ok && value >= 0 && value <= 10 && len(scores) < 12 {
					scores = append(scores, Object{"provider": provider, "version": shortIntel(str(score, "version"), 10), "score": value, "vector": shortIntel(str(score, "vectorString"), 250)})
				}
			}
			other := object(metric["other"])
			content := object(other["content"])
			if str(other, "type") == "ssvc" && str(content, "id") == id && len(ssvc) < 4 {
				options := []Object{}
				for index, option := range objects(content["options"]) {
					if index >= 10 {
						break
					}
					for key, value := range option {
						if len(key) <= 100 && len(text(value)) <= 100 {
							options = append(options, Object{"name": key, "value": text(value)})
						}
					}
				}
				ssvc = append(ssvc, Object{"provider": provider, "role": shortIntel(str(content, "role"), 100), "timestamp": shortIntel(str(content, "timestamp"), 100), "options": options})
			}
		}
		for _, ref := range objects(section["references"]) {
			link := safeIntelURL(str(ref, "url"))
			if link == "" || seen[link] {
				continue
			}
			kind := "advisory"
			if contains(stringsOf(ref["tags"]), "exploit") {
				kind = "exploit"
			} else if contains(stringsOf(ref["tags"]), "mitigation") {
				kind = "mitigation"
			}
			if len(refs) < 12 || kind == "exploit" && len(refs) < 20 {
				refs = append(refs, Object{"url": link, "title": shortIntel(str(ref, "name"), 250), "kind": kind, "provider": provider})
				seen[link] = true
			}
		}
	}
	sort.SliceStable(refs, func(a, b int) bool { return str(refs[a], "kind") == "exploit" && str(refs[b], "kind") != "exploit" })
	result["scores"], result["references"], result["ssvc"] = scores, refs, ssvc
	return result, nil
}
func (i *Intelligence) refresh(input Object) (Object, error) {
	ids, err := intelIDs(input["cves"], 50)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return Object{}, nil
	}
	requestID, err := bounded(input["requestId"], "Request ID", 128)
	if err != nil || requestID == "" {
		return nil, errors.New("A request ID is required")
	}
	if !i.refreshMu.TryLock() {
		return nil, errors.New("An intelligence refresh is already running; cancel it or wait for completion")
	}
	defer i.refreshMu.Unlock()
	settings, err := i.settings()
	if err != nil {
		return nil, err
	}
	enabled := stringsOf(settings["enabledSources"])
	if len(enabled) == 0 {
		return nil, errors.New("Enable public intelligence sources in Settings before refreshing")
	}
	ctx, cancel := context.WithTimeout(i.parent, 90*time.Second)
	defer cancel()
	i.mu.Lock()
	generation := i.generation
	if i.clock().Before(i.cancellationBarrier) {
		i.mu.Unlock()
		return nil, errors.New("Intelligence refresh is paused while cancellation records expire")
	}
	for key, at := range i.canceled {
		if i.clock().Sub(at) > 2*time.Minute {
			delete(i.canceled, key)
		}
	}
	if _, canceled := i.canceled[requestID]; canceled {
		delete(i.canceled, requestID)
		i.mu.Unlock()
		return nil, errors.New("Intelligence refresh was canceled")
	}
	i.runs[requestID] = cancel
	i.mu.Unlock()
	defer func() { i.mu.Lock(); delete(i.runs, requestID); i.mu.Unlock() }()
	previous, err := i.get(input["cves"])
	if err != nil {
		return nil, err
	}
	var feed, epss Object
	var feedErr, epssErr error
	if contains(enabled, "kev") {
		feed, feedErr = i.kev(ctx, boolean(input["force"]) && !boolean(input["reuseCatalog"]))
	}
	if contains(enabled, "epss") {
		epss, epssErr = i.epss(ctx, ids)
	}
	var outputMu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, 3)
	var saveErr error
	for _, id := range ids {
		if ctx.Err() != nil {
			break
		}
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			continue
		}
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			defer func() { <-slots }()
			old := object(previous[id])
			sources := []Object{}
			for _, source := range []string{"kev", "epss", "cve"} {
				prior := observation(old, source)
				if !contains(enabled, source) {
					sources = append(sources, prior)
					continue
				}
				var obs Object
				var failure error
				switch source {
				case "kev":
					failure = feedErr
					if failure == nil {
						value := object(object(feed["value"])[id])
						if len(value) == 0 {
							value = Object{"listed": false}
						}
						obs = Object{"source": "kev", "state": feed["state"], "fetchedAt": feed["fetchedAt"], "checkedAt": feed["checkedAt"], "expiresAt": feed["expiresAt"], "value": value}
					}
				case "epss":
					failure = epssErr
					if failure == nil {
						obs = object(epss[id])
						if len(obs) == 0 {
							failure = errors.New("No EPSS score is published for this CVE")
						}
					}
				case "cve":
					if !boolean(input["force"]) && str(prior, "state") == "fresh" && number(prior["expiresAt"]) > float64(i.clock().UnixMilli()) {
						obs = prior
						break
					}
					raw, err := i.readJSON(ctx, "https://cveawg.mitre.org/api/cve/"+id, 2<<20)
					failure = err
					if failure == nil {
						value, err := parseCVE(raw, id)
						failure = err
						if err == nil {
							obs = freshObservation(source, value, i.clock(), 24*time.Hour)
						}
					}
				}
				if failure != nil {
					obs = failedObservation(source, prior, failure, i.clock())
				}
				sources = append(sources, obs)
			}
			snapshot := Object{"cve": id, "sources": sources, "checkedAt": i.clock().UnixMilli(), "synthetic": i.synthetic}
			i.mu.Lock()
			if ctx.Err() == nil && generation == i.generation {
				var err error
				if i.commitSnapshot != nil {
					err = i.commitSnapshot(snapshot)
				} else {
					err = i.store.save(record{kind: "intel-cache", id: id, value: snapshot})
				}
				if err == nil {
					err = i.recordChange(old, snapshot)
				}
				outputMu.Lock()
				if err != nil {
					saveErr = err
				}
				outputMu.Unlock()
			}
			i.mu.Unlock()
		}(id)
	}
	wg.Wait()
	if saveErr != nil {
		return nil, saveErr
	}
	if ctx.Err() != nil {
		return nil, errors.New("Intelligence refresh was canceled or timed out; completed observations remain cached")
	}
	if err := i.trimCache(); err != nil {
		return nil, err
	}
	return i.get(input["cves"])
}
func (i *Intelligence) trimCache() error {
	_, err := i.store.db.Exec("DELETE FROM records WHERE kind='intel-cache' AND id NOT IN (SELECT id FROM records WHERE kind='intel-cache' ORDER BY updated DESC LIMIT 5000)")
	return err
}
func (i *Intelligence) watch(input Object, remove bool) (Object, error) {
	id, err := normalizeCVE(str(input, "cve"))
	if err != nil {
		return nil, err
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if remove {
		err = i.store.remove("intel-watch", "", id)
	} else {
		values, err := i.store.list("intel-watch", nil)
		if err != nil {
			return nil, err
		}
		existing, err := i.store.get("intel-watch", "", id)
		if err != nil {
			return nil, err
		}
		if len(values) >= 200 && existing == nil {
			return nil, errors.New("The watchlist supports at most 200 CVEs")
		}
		if existing == nil {
			err = i.store.save(record{kind: "intel-watch", id: id, value: Object{"cve": id, "createdAt": i.clock().UnixMilli()}})
			if err != nil {
				return nil, err
			}
		}
	}
	return Object{"cve": id}, err
}
func (i *Intelligence) watchlist() (Object, error) {
	items, err := i.store.list("intel-watch", nil)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, item := range items {
		ids = append(ids, str(item, "cve"))
	}
	values, err := i.get(ids)
	if err != nil {
		return nil, err
	}
	events, err := i.store.list("intel-event", nil)
	if err != nil {
		return nil, err
	}
	if len(events) > 100 {
		events = events[:100]
	}
	return Object{"items": items, "snapshots": values, "events": events}, nil
}
func (i *Intelligence) recordChange(before, after Object) error {
	id := str(after, "cve")
	watched, err := i.store.get("intel-watch", "", id)
	if err != nil {
		return err
	}
	if watched == nil || before["checkedAt"] == nil {
		return nil
	}
	changes := []string{}
	oldKEV, newKEV := object(observation(before, "kev")["value"]), object(observation(after, "kev")["value"])
	if str(observation(after, "kev"), "state") == "fresh" && !boolean(oldKEV["listed"]) && boolean(newKEV["listed"]) {
		changes = append(changes, "Added to CISA KEV")
	}
	a, b := object(observation(before, "epss")["value"]), object(observation(after, "epss")["value"])
	if a["probability"] != nil && b["probability"] != nil && number(a["probability"]) != number(b["probability"]) {
		changes = append(changes, fmt.Sprintf("EPSS changed from %.2f%% to %.2f%%", number(a["probability"])*100, number(b["probability"])*100))
	}
	oldCVE, newCVE := object(observation(before, "cve")["value"]), object(observation(after, "cve")["value"])
	if len(oldCVE) > 0 && str(newCVE, "recordState") == "REJECTED" && str(oldCVE, "recordState") != "REJECTED" {
		changes = append(changes, "CVE record is now rejected")
	}
	if len(changes) == 0 {
		return nil
	}
	event := Object{"id": uuid(), "cve": id, "at": i.clock().UnixMilli(), "changes": changes, "before": before, "after": after}
	if err = i.store.save(record{kind: "intel-event", id: str(event, "id"), value: event}); err != nil {
		return err
	}
	_, err = i.store.db.Exec("DELETE FROM records WHERE kind='intel-event' AND id NOT IN (SELECT id FROM records WHERE kind='intel-event' ORDER BY updated DESC LIMIT 200)")
	return err
}

func (i *Intelligence) clearCache() error {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.generation++
	for _, cancel := range i.runs {
		cancel()
	}
	_, err := i.store.db.Exec("DELETE FROM records WHERE kind IN ('intel-cache','intel-feed')")
	return err
}
