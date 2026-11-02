package engine

import (
	"errors"
	"fmt"
	"html"
	"regexp"
	"sort"
	"strings"
)

var htmlBreak = regexp.MustCompile(`(?i)<br\s*/?>|</(?:p|div|li|h\d)>`)
var htmlList = regexp.MustCompile(`(?i)<li[^>]*>`)
var htmlTag = regexp.MustCompile(`<[^>]+>`)

func stripHTML(s string) string {
	s = htmlBreak.ReplaceAllString(s, "\n")
	s = htmlList.ReplaceAllString(s, "• ")
	s = htmlTag.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	for strings.Contains(s, "\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(s)
}
func stringValue(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}
func normalizeFindings(raw []any, scan, project, connection string) ([]Object, error) {
	out := make([]Object, 0, len(raw))
	counts := map[string]int{}
	evidenceCounts := map[string]int{}
	evidence := []string{}
	for _, item := range raw {
		m := object(item)
		if str(m, "id") == "" || str(m, "type") == "" {
			return nil, errors.New("Finding has no identity or scanner type")
		}
		d := object(m["data"])
		vd := object(m["vulnerabilityDetails"])
		scanner := strings.ToLower(str(m, "type"))
		severity := strings.ToUpper(strings.TrimSpace(str(m, "severity")))
		if severity == "INFORMATIONAL" || severity == "INFORMATION" {
			severity = "INFO"
		}
		if _, ok := severityOrder[severity]; !ok {
			severity = "UNKNOWN"
		}
		state := strings.ToUpper(str(m, "state"))
		if state == "NOTEXPLOITABLE" {
			state = "NOT_EXPLOITABLE"
		}
		if !contains([]string{"NOT_EXPLOITABLE", "PROPOSED_NOT_EXPLOITABLE", "CONFIRMED", "URGENT"}, state) {
			state = "TO_VERIFY"
		}
		resultStatus := strings.ToUpper(str(m, "status"))
		if !contains([]string{"NEW", "RECURRENT", "FIXED", "UNCHANGED"}, resultStatus) {
			resultStatus = "NEW"
		}
		title, where := "Finding", ""
		flow := []Object{}
		pkg := clone(object(d["packageIdentifier"]))
		sca := object(d["scaPackageData"])
		if identifier, ok := d["packageIdentifier"].(string); ok {
			pkg["name"] = identifier
			if i := strings.Index(identifier, "-"); i > 0 {
				pkg["packageManager"] = identifier[:i]
			}
			for _, path := range array(sca["dependencyPaths"]) {
				for _, node := range objects(path) {
					if str(node, "id") == identifier {
						pkg["name"] = node["name"]
						pkg["version"] = node["version"]
					}
				}
			}
		}
		switch scanner {
		case "sast":
			title = str(d, "queryName")
			if title == "" {
				title = "SAST finding"
			}
			for _, node := range objects(d["nodes"]) {
				n := clone(node)
				if n["line"] == nil {
					n["line"] = 0
				}
				if n["fileName"] == nil {
					n["fileName"] = ""
				}
				flow = append(flow, n)
			}
			if len(flow) > 0 && str(flow[0], "fileName") != "" {
				where = strings.TrimLeft(str(flow[0], "fileName"), "/")
				if number(flow[0]["line"]) > 0 {
					where += fmt.Sprintf(":%d", int(number(flow[0]["line"])))
				}
			}
		case "sca":
			title = str(vd, "cveName")
			if title == "" {
				title = str(d, "scaType")
			}
			if title == "" {
				title = "SCA finding"
			}
			if str(pkg, "name") != "" {
				title += " · " + str(pkg, "name")
				if str(pkg, "version") != "" {
					title += "@" + str(pkg, "version")
				}
			}
			for _, location := range array(sca["locations"]) {
				loc := object(location)
				if s, ok := location.(string); ok {
					loc = Object{"path": s}
				}
				if str(loc, "path") != "" {
					flow = append(flow, Object{"fileName": loc["path"], "line": number(loc["line"])})
				}
			}
			if len(flow) > 0 {
				where = strings.TrimLeft(str(flow[0], "fileName"), "/")
			}
		default:
			title = str(d, "queryName")
			if title == "" {
				title = str(m, "label")
			}
			if title == "" {
				title = "Finding"
			}
			if str(d, "filename") != "" {
				where = strings.TrimLeft(str(d, "filename"), "/")
				if number(d["line"]) > 0 {
					where += fmt.Sprintf(":%d", int(number(d["line"])))
				}
				flow = append(flow, Object{"fileName": d["filename"], "line": number(d["line"])})
			}
		}
		description := str(m, "descriptionHTML")
		if description == "" {
			description = str(m, "description")
		}
		f := Object{"id": m["id"], "vendorId": m["id"], "scanId": scan, "projectId": project, "connectionId": connection, "type": scanner, "label": m["label"], "similarityId": stringValue(m["similarityId"]), "severity": severity, "state": state, "status": resultStatus, "title": title, "where": where, "description": stripHTML(description), "flow": flow}
		if str(f, "label") == "" {
			f["label"] = scanner
		}
		for _, k := range []string{"created", "comments"} {
			if m[k] != nil {
				f[k] = m[k]
			}
		}
		if m["severity"] != nil {
			f["rawSeverity"] = stringValue(m["severity"])
		}
		for _, p := range [][2]string{{"language", "languageName"}, {"group", "group"}, {"recommendedVersion", "recommendedVersion"}, {"redundancy", "redundancy"}} {
			if d[p[1]] != nil {
				f[p[0]] = d[p[1]]
			}
		}
		for _, p := range [][2]string{{"cve", "cveName"}, {"cvssScore", "cvssScore"}, {"compliances", "compliances"}} {
			if vd[p[1]] != nil {
				f[p[0]] = vd[p[1]]
			}
		}
		if vd["cweId"] != nil {
			f["cwe"] = stringValue(vd["cweId"])
		}
		for _, p := range [][2]string{{"packageName", "name"}, {"packageVersion", "version"}, {"packageManager", "packageManager"}} {
			if pkg[p[1]] != nil {
				f[p[0]] = pkg[p[1]]
			}
		}
		for _, k := range []string{"dependencyPaths", "isDirectDependency", "fixLink"} {
			if sca[k] != nil {
				f[k] = sca[k]
			}
		}
		counts[str(f, "id")]++
		key := string(jsonValue([]any{scan, project, scanner, f["vendorId"], f["similarityId"], f["cve"], f["packageManager"], f["packageName"], f["packageVersion"], flow}))
		evidence = append(evidence, key)
		evidenceCounts[key]++
		out = append(out, f)
	}
	used := map[string]bool{}
	for _, f := range out {
		used[str(f, "id")] = true
	}
	for i, f := range out {
		if counts[str(f, "id")] < 2 {
			continue
		}
		stem := "occurrence:" + hash([]byte(evidence[i]))
		id := stem
		for n := 1; used[id]; n++ {
			id = fmt.Sprintf("%s:%d", stem, n)
		}
		used[id] = true
		f["id"] = id
		if evidenceCounts[evidence[i]] > 1 {
			f["identityAmbiguous"] = true
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return severityOrder[str(out[i], "severity")] > severityOrder[str(out[j], "severity")]
	})
	return out, nil
}
