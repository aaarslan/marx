package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (e *Engine) decisionFinding(scanID, findingID string) (Object, Object, error) {
	connection, err := e.connection(true)
	if err != nil {
		return nil, nil, err
	}
	page, err := e.store.get("snapshot", connection, scanID)
	if err != nil {
		return nil, nil, err
	}
	if page == nil {
		return nil, nil, errors.New("Import the scan in this connection before recording a decision")
	}
	for _, finding := range objects(page["findings"]) {
		if str(finding, "id") == findingID {
			if _, err := normalizeCVE(str(finding, "cve")); err != nil {
				return nil, nil, errors.New("This finding has no explicit CVE ID")
			}
			return page, finding, nil
		}
	}
	return nil, nil, errors.New("Finding is unavailable in the selected scan")
}
func (e *Engine) recordDecision(input Object) (Object, error) {
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	page, finding, err := e.decisionFinding(str(input, "scanId"), str(input, "findingId"))
	if err != nil {
		return nil, err
	}
	cve, _ := normalizeCVE(str(finding, "cve"))
	connection := pageConnection(page)
	if str(input, "connectionId") != connection {
		return nil, errors.New("The Checkmarx connection changed; reload before recording a decision")
	}
	key := hash(jsonValue([]string{connection, str(finding, "projectId"), str(finding, "id"), str(finding, "packageName"), str(finding, "packageVersion"), cve}))
	current, err := e.store.get("intel-decision", connection, key)
	if err != nil {
		return nil, err
	}
	if number(input["expectedRevision"]) != number(current["revision"]) {
		return nil, errors.New("This decision changed; reload before saving")
	}
	if number(current["revision"]) >= 100 {
		return nil, errors.New("Decision revision limit reached; export its history before recording further changes")
	}
	verdict := str(input, "verdict")
	if !contains([]string{"patch_now", "defer", "accept", "not_affected", "mitigated"}, verdict) {
		return nil, errors.New("Choose a supported decision")
	}
	note, err := bounded(input["note"], "Decision rationale", 2000)
	if err != nil {
		return nil, err
	}
	note = strings.TrimSpace(note)
	if note == "" {
		return nil, errors.New("Record the evidence and reason for this decision")
	}
	review := str(input, "reviewAt")
	date, err := time.Parse("2006-01-02", review)
	today := e.intel.clock().UTC().Truncate(24 * time.Hour)
	if err != nil || date.Before(today) || date.After(today.Add(3650*24*time.Hour)) {
		return nil, errors.New("Choose a review date between today and ten years from now")
	}
	if verdict == "defer" && !date.After(today) {
		return nil, errors.New("Choose a future date when deferring a finding")
	}
	values, err := e.intel.get([]string{cve})
	if err != nil {
		return nil, err
	}
	snapshot := object(values[cve])
	assumptions := Object{"manual": ""}
	requested := object(input["assumptions"])
	if boolean(requested["notInKev"]) {
		obs := observation(snapshot, "kev")
		value := object(obs["value"])
		if str(obs, "state") != "fresh" || value["listed"] == nil || boolean(value["listed"]) {
			return nil, errors.New("A fresh CISA observation showing no listing is required for that assumption")
		}
		assumptions["notInKev"] = true
	}
	if requested["epssBelow"] != nil {
		threshold := number(requested["epssBelow"])
		obs := observation(snapshot, "epss")
		value := object(obs["value"])
		if threshold <= 0 || threshold > 1 || str(obs, "state") != "fresh" || value["probability"] == nil || number(value["probability"]) >= threshold {
			return nil, errors.New("The EPSS assumption needs a valid threshold above a fresh published score")
		}
		assumptions["epssBelow"] = threshold
	}
	manual, err := bounded(str(requested, "manual"), "Manual assumption", 1000)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(manual) != "" {
		assumptions["manual"] = strings.TrimSpace(manual)
	}
	decisions, err := e.store.list("intel-decision", nil)
	if err != nil {
		return nil, err
	}
	if current == nil && len(decisions) >= 1000 {
		return nil, errors.New("At most 1,000 scoped decisions can be retained")
	}
	decision := Object{"id": key, "revision": int(number(current["revision"])) + 1, "connectionId": connection, "scanId": str(input, "scanId"), "findingId": str(finding, "id"), "projectId": str(finding, "projectId"), "cve": cve, "packageName": str(finding, "packageName"), "packageVersion": str(finding, "packageVersion"), "packageManager": str(finding, "packageManager"), "title": str(finding, "title"), "verdict": verdict, "note": note, "reviewAt": review, "assumptions": assumptions, "evidence": snapshot, "updatedAt": e.intel.clock().UnixMilli(), "closed": false}
	if current == nil {
		decision["createdAt"] = decision["updatedAt"]
	} else {
		decision["createdAt"] = current["createdAt"]
	}
	revisionID := fmt.Sprintf("%s:%d", key, int(number(decision["revision"])))
	if err = e.store.save(record{kind: "intel-decision", scope: connection, id: key, value: decision}, record{kind: "intel-decision-history", scope: connection, id: revisionID, value: decision, immutable: true}, record{kind: "intel-decision-index", scope: cve, id: key, value: Object{"id": key, "connectionId": connection}}); err != nil {
		return nil, err
	}
	return e.reviewDecision(decision), nil
}
func (e *Engine) reviewDecision(decision Object) Object {
	result := clone(decision)
	reasons := []string{}
	state := "active"
	if boolean(decision["closed"]) {
		result["reviewState"] = "closed"
		result["reviewReasons"] = reasons
		return result
	}
	values, err := e.intel.get([]string{str(decision, "cve")})
	snapshot := object(values[str(decision, "cve")])
	if err != nil {
		state = "unavailable"
		reasons = append(reasons, "Current intelligence could not be read")
	}
	assumptions := object(decision["assumptions"])
	for _, source := range []string{"kev", "epss"} {
		relevant := source == "kev" && boolean(assumptions["notInKev"]) || source == "epss" && assumptions["epssBelow"] != nil
		if !relevant {
			continue
		}
		obs := observation(snapshot, source)
		value := object(obs["value"])
		if str(obs, "state") != "fresh" {
			if state == "active" {
				state = "unavailable"
			}
			reasons = append(reasons, "The "+strings.ToUpper(source)+" assumption cannot be rechecked with fresh evidence")
			continue
		}
		if source == "kev" && boolean(value["listed"]) {
			state = "needs_review"
			reasons = append(reasons, "The CVE is now listed in CISA KEV")
		}
		if source == "epss" && value["probability"] != nil && number(value["probability"]) >= number(assumptions["epssBelow"]) {
			state = "needs_review"
			reasons = append(reasons, "EPSS has reached or exceeded the recorded threshold")
		}
	}
	if str(object(observation(object(decision["evidence"]), "cve")["value"]), "recordState") != "REJECTED" && str(object(observation(snapshot, "cve")["value"]), "recordState") == "REJECTED" && str(observation(snapshot, "cve"), "state") == "fresh" {
		state = "needs_review"
		reasons = append(reasons, "The CVE record is rejected; reassess this finding's identity and applicability")
	}
	review, err := time.Parse("2006-01-02", str(decision, "reviewAt"))
	if err != nil || !e.intel.clock().UTC().Truncate(24*time.Hour).Before(review) {
		if state == "active" || state == "unavailable" {
			state = "review_due"
		}
		reasons = append(reasons, "The recorded review date has arrived")
	}
	alert, alertErr := e.store.get("intel-decision-alert", str(decision, "connectionId"), fmt.Sprintf("%s:%d", str(decision, "id"), int(number(decision["revision"]))))
	if alertErr != nil {
		if state != "needs_review" {
			state = "unavailable"
		}
		reasons = append(reasons, "Stored review alerts could not be read")
	}
	if alert != nil {
		state = "needs_review"
		for _, reason := range stringsOf(alert["reasons"]) {
			if !contains(reasons, reason) {
				reasons = append(reasons, reason)
			}
		}
		result["reviewAlert"] = alert
	}
	result["reviewState"], result["reviewReasons"], result["currentEvidence"] = state, reasons, snapshot
	return result
}
func (e *Engine) decisions() ([]Object, error) {
	connection, err := e.connection(true)
	if err != nil {
		return []Object{}, nil
	}
	decisions, err := e.store.list("intel-decision", &connection)
	if err != nil {
		return nil, err
	}
	result := []Object{}
	for _, decision := range decisions {
		result = append(result, e.reviewDecision(decision))
	}
	return result, nil
}
func (e *Engine) decisionHistory(id string) ([]Object, error) {
	connection, err := e.connection(true)
	if err != nil {
		return nil, err
	}
	decision, err := e.store.get("intel-decision", connection, id)
	if err != nil {
		return nil, err
	}
	if decision == nil {
		return nil, errors.New("Decision is unavailable in this connection")
	}
	rows, err := e.store.db.Query("SELECT payload FROM records WHERE kind='intel-decision-history' AND scope=? AND id LIKE ? ORDER BY updated DESC,id DESC", connection, id+":%")
	if err != nil {
		return nil, err
	}
	revisions := []Object{}
	for rows.Next() {
		var data []byte
		var revision Object
		if err = rows.Scan(&data); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal(data, &revision); err != nil {
			rows.Close()
			return nil, err
		}
		revisions = append(revisions, revision)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	result := []Object{}
	for _, revision := range revisions {
		alert, err := e.store.get("intel-decision-alert", connection, fmt.Sprintf("%s:%d", id, int(number(revision["revision"]))))
		if err != nil {
			return nil, err
		}
		if alert != nil {
			revision["reviewAlert"] = alert
		}
		result = append(result, revision)
	}
	return result, nil
}
func (e *Engine) closeDecision(input Object) (Object, error) {
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	connection, err := e.connection(true)
	if err != nil {
		return nil, err
	}
	id := str(input, "id")
	decision, err := e.store.get("intel-decision", connection, id)
	if err != nil {
		return nil, err
	}
	if decision == nil {
		return nil, errors.New("Decision is unavailable in this connection")
	}
	if number(input["expectedRevision"]) != number(decision["revision"]) {
		return nil, errors.New("This decision changed; reload before closing")
	}
	if boolean(decision["closed"]) {
		return e.reviewDecision(decision), nil
	}
	if number(decision["revision"]) >= 100 {
		return nil, errors.New("Decision revision limit reached")
	}
	reason, err := bounded(input["reason"], "Closure reason", 1000)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(reason) == "" {
		return nil, errors.New("Record why this decision is being closed")
	}
	decision["closed"], decision["closeReason"], decision["updatedAt"], decision["revision"] = true, strings.TrimSpace(reason), e.intel.clock().UnixMilli(), int(number(decision["revision"]))+1
	revisionID := fmt.Sprintf("%s:%d", id, int(number(decision["revision"])))
	err = e.store.save(record{kind: "intel-decision", scope: connection, id: id, value: decision}, record{kind: "intel-decision-history", scope: connection, id: revisionID, value: decision, immutable: true})
	return e.reviewDecision(decision), err
}
func (e *Engine) exportDecisions() (any, error) {
	decisions, err := e.decisions()
	if err != nil {
		return nil, err
	}
	histories := []Object{}
	usedBytes := len(jsonValue(decisions)) + 1024
	if usedBytes > 32<<20 {
		return nil, errors.New("Decision export exceeds its 32 MiB limit")
	}
	for _, decision := range decisions {
		history, err := e.decisionHistory(str(decision, "id"))
		if err != nil {
			return nil, err
		}
		usedBytes += len(jsonValue(history)) + 256
		if usedBytes > 32<<20 {
			return nil, errors.New("Decision export exceeds its 32 MiB limit")
		}
		histories = append(histories, Object{"id": decision["id"], "revisions": history})
	}
	bundle := Object{"format": "marx-cve-decisions", "version": 1, "exportedAt": e.intel.clock().UTC().Format(time.RFC3339Nano), "decisions": decisions, "history": histories, "notice": "Local decisions and intelligence observations. These do not change Checkmarx result states or prove that a finding is fixed or not exploitable."}
	if len(jsonValue(bundle)) > 32<<20 {
		return nil, errors.New("Decision export exceeds its 32 MiB limit")
	}
	data, _ := json.MarshalIndent(bundle, "", "  ")
	return e.saveEvidence("Export CVE decisions", "marx-cve-decisions.json", data)
}

func (e *Engine) commitIntelSnapshot(snapshot Object) error {
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	cve := str(snapshot, "cve")
	pointers, err := e.store.list("intel-decision-index", &cve)
	if err != nil {
		return err
	}
	records := []record{{kind: "intel-cache", id: cve, value: snapshot}}
	for _, pointer := range pointers {
		connection, id := str(pointer, "connectionId"), str(pointer, "id")
		decision, err := e.store.get("intel-decision", connection, id)
		if err != nil {
			return err
		}
		if decision == nil || boolean(decision["closed"]) {
			continue
		}
		reasons := []string{}
		assumptions := object(decision["assumptions"])
		kev, epss := observation(snapshot, "kev"), observation(snapshot, "epss")
		if boolean(assumptions["notInKev"]) && str(kev, "state") == "fresh" && boolean(object(kev["value"])["listed"]) {
			reasons = append(reasons, "The CVE is now listed in CISA KEV")
		}
		if assumptions["epssBelow"] != nil && str(epss, "state") == "fresh" && object(epss["value"])["probability"] != nil && number(object(epss["value"])["probability"]) >= number(assumptions["epssBelow"]) {
			reasons = append(reasons, "EPSS has reached or exceeded the recorded threshold")
		}
		currentRecord := observation(snapshot, "cve")
		if str(currentRecord, "state") == "fresh" && str(object(currentRecord["value"]), "recordState") == "REJECTED" && str(object(observation(object(decision["evidence"]), "cve")["value"]), "recordState") != "REJECTED" {
			reasons = append(reasons, "The CVE record is rejected; reassess this finding's identity and applicability")
		}
		if len(reasons) > 0 {
			revisionID := fmt.Sprintf("%s:%d", id, int(number(decision["revision"])))
			records = append(records, record{kind: "intel-decision-alert", scope: connection, id: revisionID, value: Object{"at": e.intel.clock().UnixMilli(), "reasons": reasons, "evidence": snapshot}, immutable: true})
		}
	}
	return e.store.save(records...)
}
