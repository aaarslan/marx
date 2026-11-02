package engine

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

func present(v any) bool {
	s := strings.TrimSpace(text(v))
	return s != "" && s != "null" && s != "undefined"
}
func findingIdentity(f Object) string {
	scanner := strings.ToLower(str(f, "type"))
	if scanner == "sca" {
		for _, k := range []string{"packageManager", "packageName", "packageVersion", "cve"} {
			if !present(f[k]) {
				return ""
			}
		}
		return string(jsonValue([]string{scanner, strings.ToLower(str(f, "packageManager")), str(f, "packageName"), str(f, "packageVersion"), str(f, "cve")}))
	}
	if (scanner == "sast" || scanner == "kics") && present(f["similarityId"]) {
		return string(jsonValue([]string{scanner, str(f, "similarityId")}))
	}
	return ""
}
func groupIdentity(findings []Object) map[string][]Object {
	r := map[string][]Object{}
	for _, f := range findings {
		if k := findingIdentity(f); k != "" {
			r[k] = append(r[k], f)
		}
	}
	return r
}
func duplicateIDs(findings []Object) map[string]bool {
	seen, duplicates := map[string]bool{}, map[string]bool{}
	for _, f := range findings {
		k := str(f, "id")
		if seen[k] {
			duplicates[k] = true
		}
		seen[k] = true
	}
	return duplicates
}
func provenance(page Object) Object {
	p := object(page["provenance"])
	if len(p) == 0 {
		p = object(object(page["scan"])["provenance"])
	}
	return p
}
func pageConnection(page Object) string {
	if v := str(page, "connectionId"); v != "" {
		return v
	}
	if v := str(provenance(page), "connectionId"); v != "" {
		return v
	}
	return str(object(page["scan"]), "connectionId")
}
func complete(page Object) bool {
	findings := array(page["findings"])
	if str(object(page["scan"]), "status") != "Completed" || boolean(page["truncated"]) || number(page["totalCount"]) != float64(len(findings)) {
		return false
	}
	c := object(page["counts"])
	return len(c) == 0 || (number(c["reported"]) == number(c["received"]) && number(c["received"]) == number(c["normalized"]) && number(c["normalized"]) == float64(len(findings)) && number(c["unsupported"]) == 0)
}
func parseTime(v any) (time.Time, error) { return time.Parse(time.RFC3339Nano, text(v)) }
func sortedStrings(v any) []string       { r := stringsOf(v); sort.Strings(r); return r }
func requestedConfig(o Object) string {
	return string(jsonValue(Object{"scanners": sortedStrings(o["scanners"]), "sastPreset": str(o, "sastPreset"), "sastIncremental": boolean(o["sastIncremental"]), "sastBaseBranch": str(o, "sastBaseBranch"), "scaExploitablePath": boolean(o["scaExploitablePath"]), "excludes": sortedStrings(o["excludes"])}))
}
func scanners(v any) string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range stringsOf(v) {
		s = strings.ToLower(strings.TrimSpace(s))
		if !seen[s] {
			out = append(out, s)
			seen[s] = true
		}
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}
func compareScans(baseline, current Object) Object {
	reasons := []string{}
	incompatible, differentScope := false, false
	flag := func(message string, bad bool) {
		if !contains(reasons, message) {
			reasons = append(reasons, message)
		}
		incompatible = incompatible || bad
	}
	bs, cs := object(baseline["scan"]), object(current["scan"])
	bc, cc := pageConnection(baseline), pageConnection(current)
	for _, p := range [][3]string{{bc, cc, "Checkmarx connections"}, {str(bs, "projectId"), str(cs, "projectId"), "Checkmarx projects"}} {
		if !present(p[0]) || !present(p[1]) {
			flag("Connection or project identity is missing from one or both scans.", false)
		} else if p[0] != p[1] {
			differentScope = true
			flag("The scans belong to different "+p[2]+".", true)
		}
	}
	if str(bs, "id") != "" && str(bs, "id") == str(cs, "id") {
		differentScope = true
		flag("Choose two different scans.", true)
	}
	bt, be := parseTime(bs["createdAt"])
	ct, ce := parseTime(cs["createdAt"])
	if be != nil || ce != nil {
		flag("Scan timestamps are missing or unrecognized.", false)
	} else if !bt.Before(ct) {
		flag("The baseline must be older than the current scan.", true)
	}
	if !complete(baseline) || !complete(current) {
		flag("Both scans must be completed and all findings received and normalized. Missing results cannot establish absence.", false)
	}
	bp, cp := provenance(baseline), provenance(current)
	if len(bp) == 0 || len(cp) == 0 {
		flag("Scan provenance is missing. Recorded scan settings and source identity cannot be checked.", false)
	} else {
		if !present(bp["optionsFingerprint"]) || !present(cp["optionsFingerprint"]) {
			flag("The recorded request configuration is incomplete.", false)
		}
		if requestedConfig(object(bp["options"])) != requestedConfig(object(cp["options"])) {
			flag("Requested scanners, presets, exclusions or scan options differ.", true)
		}
		rb, rc, eb, ec := scanners(bp["requestedScanners"]), scanners(cp["requestedScanners"]), scanners(bp["completedScanners"]), scanners(cp["completedScanners"])
		if rb == "" || rc == "" || eb == "" || ec == "" {
			flag("Successful engine coverage is not recorded for both scans. An overall Completed status is insufficient.", false)
		} else if rb != rc || eb != ec || rb != eb || rc != ec {
			flag("The scans do not have matching requested and successfully completed engine coverage.", true)
		}
		if !present(bp["effectiveConfigFingerprint"]) || !present(cp["effectiveConfigFingerprint"]) {
			flag("Effective server configuration is unverified. Matching locally requested options do not prove equivalent scan coverage.", false)
		} else if bp["effectiveConfigFingerprint"] != cp["effectiveConfigFingerprint"] {
			flag("The effective server scan configurations differ. Absent findings may not have been evaluated.", true)
		}
		bsource, csource := object(bp["source"]), object(cp["source"])
		if str(bsource, "folderPath") != str(csource, "folderPath") || (str(bsource, "repositoryRoot") != "" && str(csource, "repositoryRoot") != "" && str(bsource, "repositoryRoot") != str(csource, "repositoryRoot")) {
			flag("The recorded source folders differ. A shared remote project does not establish equivalent repository scope.", false)
		}
		for _, item := range []struct {
			label      string
			p, scan    Object
			connection string
		}{{"Baseline", bp, bs, bc}, {"Current", cp, cs, cc}} {
			source := object(item.p["source"])
			if str(item.p, "connectionId") != item.connection {
				flag(item.label+" provenance does not match its connection identity.", true)
			}
			if !present(source["fingerprint"]) {
				flag(item.label+" source fingerprint is unavailable.", false)
			}
			if !boolean(source["snapshot"]) && item.p["sourceChanged"] != false {
				flag(item.label+" source was scanned from a live folder without a confirmed unchanged capture.", false)
			}
			if boolean(item.p["sourceChanged"]) {
				flag(item.label+" source changed while the scan was running.", false)
			}
			if str(item.scan, "branch") != "" && str(source, "branch") != str(item.scan, "branch") {
				flag(item.label+" source branch differs from its scan metadata.", true)
			}
		}
	}
	old, latest := objects(baseline["findings"]), objects(current["findings"])
	og, ng := groupIdentity(old), groupIdentity(latest)
	od, nd := duplicateIDs(old), duplicateIDs(latest)
	if len(od)+len(nd) > 0 {
		flag("Duplicate result IDs prevent unambiguous occurrence matching.", false)
	}
	for _, pair := range []struct {
		page       Object
		findings   []Object
		connection string
		scan       Object
	}{{baseline, old, bc, bs}, {current, latest, cc, cs}} {
		for _, f := range pair.findings {
			if boolean(f["identityAmbiguous"]) {
				flag("Some occurrence keys only disambiguate duplicate vendor records and cannot prove equivalence between scans.", false)
			}
			if findingIdentity(f) == "" {
				flag("Some findings lack stable scanner identities or package metadata. Titles and source locations are not used as identity.", false)
			}
			if str(f, "severity") == "UNKNOWN" {
				flag("Unknown severity values require review before a passing verdict.", false)
			}
			if str(f, "projectId") != str(pair.scan, "projectId") || str(f, "scanId") != str(pair.scan, "id") || (str(f, "connectionId") != "" && str(f, "connectionId") != pair.connection) {
				differentScope = true
				flag("Finding provenance does not match the enclosing scan or connection.", true)
			}
		}
	}
	for _, groups := range []map[string][]Object{og, ng} {
		for _, group := range groups {
			if len(group) > 1 {
				flag("Some scanner identities describe multiple occurrences. Those families remain uncertain rather than collapsing distinct findings.", false)
			}
		}
	}
	changes, newBySeverity := Object{}, Object{}
	newCount, persistent, escalated, reduced, blocking := 0, 0, 0, 0, 0
	for _, f := range latest {
		k := findingIdentity(f)
		previous, occurrences := og[k], ng[k]
		change := "UNCERTAIN"
		if !differentScope && k != "" && !boolean(f["identityAmbiguous"]) && !nd[str(f, "id")] && len(occurrences) == 1 && (len(previous) == 0 || (len(previous) == 1 && !boolean(previous[0]["identityAmbiguous"]) && !od[str(previous[0], "id")])) {
			if len(previous) == 0 && complete(baseline) {
				change = "NEW"
				newCount++
				sev := str(f, "severity")
				newBySeverity[sev] = number(newBySeverity[sev]) + 1
			} else if len(previous) == 1 && str(f, "severity") != "UNKNOWN" && str(previous[0], "severity") != "UNKNOWN" {
				r, b := severityOrder[str(f, "severity")], severityOrder[str(previous[0], "severity")]
				switch {
				case r > b:
					change = "ESCALATED"
					escalated++
					if r >= 4 {
						blocking++
					}
				case r < b:
					change = "REDUCED"
					reduced++
				default:
					change = "PERSISTENT"
					persistent++
				}
			}
		}
		changes[str(f, "id")] = change
	}
	absent := []Object{}
	if !differentScope && complete(baseline) && complete(current) {
		for _, f := range old {
			k := findingIdentity(f)
			if k != "" && !boolean(f["identityAmbiguous"]) && !od[str(f, "id")] && len(og[k]) == 1 && len(ng[k]) == 0 {
				absent = append(absent, f)
			}
		}
	}
	compatibility := "comparable"
	if incompatible {
		compatibility = "incompatible"
	} else if len(reasons) > 0 {
		compatibility = "inconclusive"
	}
	attention := int(number(newBySeverity["HIGH"])+number(newBySeverity["CRITICAL"])) + blocking
	verdict, headline := "inconclusive", fmt.Sprintf("Comparison %s; %d observed new findings", compatibility, newCount)
	if attention > 0 {
		verdict = "attention"
		headline = fmt.Sprintf("%d new or escalated High/Critical findings require attention", attention)
		if compatibility != "comparable" {
			headline += "; comparison coverage is unverified"
		}
	} else if compatibility == "comparable" {
		verdict = "pass"
		headline = "No new High or Critical findings"
	}
	return Object{"compatibility": compatibility, "reasons": reasons, "changes": changes, "newBySeverity": newBySeverity, "newCount": newCount, "persistentCount": persistent, "escalatedCount": escalated, "reducedCount": reduced, "absent": absent, "verdict": verdict, "headline": headline}
}
func verifySelected(baseline, current Object, ids []string, comparison Object) ([]string, []string) {
	remaining, absent := []string{}, []string{}
	candidates := map[string]bool{}
	for _, f := range objects(comparison["absent"]) {
		candidates[str(f, "id")] = true
	}
	groups := map[string][]Object{}
	for _, f := range objects(baseline["findings"]) {
		groups[str(f, "id")] = append(groups[str(f, "id")], f)
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		matches := groups[id]
		gone := complete(baseline) && complete(current) && len(matches) == 1 && !boolean(matches[0]["identityAmbiguous"]) && candidates[id]
		if gone && str(matches[0], "type") == "sca" {
			target := matches[0]
			for _, k := range []string{"packageManager", "packageName", "cve"} {
				if !present(target[k]) {
					gone = false
				}
			}
			for _, f := range objects(current["findings"]) {
				if str(f, "type") != "sca" {
					continue
				}
				manager, name, cve := str(f, "packageManager"), str(f, "packageName"), str(f, "cve")
				if (manager == "" || strings.EqualFold(manager, str(target, "packageManager"))) && (name == "" || name == str(target, "packageName")) && (cve == "" || strings.EqualFold(cve, str(target, "cve"))) {
					gone = false
				}
			}
		}
		if gone {
			absent = append(absent, id)
		} else {
			remaining = append(remaining, id)
		}
	}
	return remaining, absent
}
