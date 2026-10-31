package engine

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var workspaceMarkers = []string{"package.json", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "go.mod", "Cargo.toml", "requirements.txt", "pyproject.toml", "Gemfile", "composer.json", "pubspec.yaml", "Makefile"}
var sharedFiles = []string{"package.json", "package-lock.json", "bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json", "nx.json", "Cargo.lock", "go.work"}

func smallManifest(folder string) Object {
	file := filepath.Join(folder, "package.json")
	info, err := os.Lstat(file)
	if err != nil || info.Mode()&os.ModeSymlink != 0 {
		return Object{}
	}
	data, err := readBounded(file, 1<<20)
	if err != nil {
		return Object{}
	}
	var m Object
	if json.Unmarshal(data, &m) != nil || m == nil {
		return Object{}
	}
	return m
}
func expandBraces(pattern string) ([]string, bool) {
	pending := []string{pattern}
	out := []string{}
	limited := false
	for len(pending) > 0 && len(out) < 100 {
		current := pending[0]
		pending = pending[1:]
		start := -1
		end := -1
		for i, c := range current {
			if c == '{' {
				start = i
			}
			if c == '}' && start >= 0 {
				end = i
				break
			}
		}
		if start < 0 || end < 0 {
			out = append(out, current)
			continue
		}
		parts := strings.Split(current[start+1:end], ",")
		if len(parts) > 20 {
			limited = true
			continue
		}
		for _, part := range parts {
			if len(pending)+len(out) >= 100 {
				limited = true
				break
			}
			pending = append(pending, current[:start]+part+current[end+1:])
		}
	}
	return out, limited || len(pending) > 0
}
func workspaceGlob(pattern string) (*regexp.Regexp, error) {
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(pattern); i++ {
		switch pattern[i] {
		case '*':
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				i++
				if i+1 < len(pattern) && pattern[i+1] == '/' {
					i++
					b.WriteString("(?:.*/)?")
				} else {
					b.WriteString(".*")
				}
			} else {
				b.WriteString("[^/]*")
			}
		case '?':
			b.WriteString("[^/]")
		default:
			b.WriteString(regexp.QuoteMeta(pattern[i : i+1]))
		}
	}
	b.WriteString("$")
	return regexp.Compile(b.String())
}
func planWorkspace(ctx context.Context, root string) (Object, error) {
	warnings := []string{}
	warn := func(s string) {
		if !contains(warnings, s) {
			warnings = append(warnings, s)
		}
	}
	data := smallManifest(root)
	patterns := stringsOf(data["workspaces"])
	if len(patterns) == 0 {
		patterns = stringsOf(object(data["workspaces"])["packages"])
	}
	pnpm := filepath.Join(root, "pnpm-workspace.yaml")
	if info, err := os.Lstat(pnpm); err == nil && info.Mode()&os.ModeSymlink == 0 {
		if content, err := readBounded(pnpm, 1<<20); err == nil {
			inPackages := false
			for _, line := range strings.Split(string(content), "\n") {
				trim := strings.TrimSpace(line)
				if strings.HasPrefix(line, "packages:") {
					inPackages = true
					if strings.TrimSpace(strings.SplitN(line, ":", 2)[1]) != "" {
						warn("Use a block list for pnpm packages; inline lists are not interpreted.")
					}
					continue
				}
				if line != "" && line[0] != ' ' && line[0] != '\t' && !strings.HasPrefix(trim, "#") {
					inPackages = false
				}
				if !inPackages || trim == "" || strings.HasPrefix(trim, "#") {
					continue
				}
				if strings.HasPrefix(trim, "- ") {
					v := strings.TrimSpace(trim[2:])
					if len(v) > 1 && (v[0] == '\'' || v[0] == '"') {
						quote := v[0]
						if end := strings.IndexByte(v[1:], quote); end >= 0 {
							v = v[1 : end+1]
						} else {
							warn("A pnpm workspace entry could not be interpreted.")
							continue
						}
					} else {
						v = strings.TrimSpace(strings.SplitN(v, "#", 2)[0])
					}
					patterns = append(patterns, v)
				} else {
					warn("A pnpm workspace entry could not be interpreted.")
				}
				if len(patterns) > 200 {
					break
				}
			}
		}
	}
	if len(patterns) > 200 {
		warn("Only the first 200 workspace patterns were interpreted.")
		patterns = patterns[:200]
	}
	type selector struct {
		exclude bool
		re      *regexp.Regexp
	}
	selectors := []selector{}
	for _, entry := range patterns {
		exclude := strings.HasPrefix(entry, "!")
		v := strings.TrimPrefix(entry, "!")
		v = strings.TrimSuffix(strings.TrimPrefix(v, "./"), "/")
		if v == "" || len(v) > 512 || filepath.IsAbs(v) || strings.ContainsAny(v, "\\[]()") || contains(strings.Split(v, "/"), "..") {
			warn("An unsupported workspace pattern was skipped.")
			continue
		}
		expanded, limited := expandBraces(v)
		if limited {
			warn("Workspace brace expansion reached its 100-pattern limit.")
		}
		for _, p := range expanded {
			if len(selectors) >= 1000 {
				warn("Discovery reached its 1,000 expanded-pattern limit.")
				break
			}
			re, err := workspaceGlob(p)
			if err == nil {
				selectors = append(selectors, selector{exclude, re})
			}
		}
	}
	type directory struct {
		path  string
		depth int
	}
	pending := []directory{{root, 0}}
	visited := map[string]bool{}
	folders := []string{}
	entriesRead := 0
	skip := []string{"node_modules", "dist", "build", "coverage", "target", "vendor"}
	for len(pending) > 0 && len(visited) < 2000 && entriesRead < 40000 && len(folders) < 1000 {
		current := pending[0]
		pending = pending[1:]
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		canonical, err := canonicalFolder(current.path)
		if err != nil || canonical != current.path || !within(root, canonical) || visited[strings.ToLower(canonical)] {
			continue
		}
		visited[strings.ToLower(canonical)] = true
		dir, err := os.Open(canonical)
		if err != nil {
			warn("Some workspace directories could not be read.")
			continue
		}
		entries, readErr := dir.ReadDir(min(40000-entriesRead+1, 40001))
		dir.Close()
		if readErr != nil && len(entries) == 0 {
			warn("Some workspace directories could not be read.")
		}
		if len(entries) > 40000-entriesRead {
			entries = entries[:40000-entriesRead]
			warn("Discovery stopped after 40,000 directory entries.")
		}
		entriesRead += len(entries)
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
		relative, _ := filepath.Rel(root, canonical)
		relative = filepath.ToSlash(relative)
		included, excluded, isProject := false, false, false
		for _, s := range selectors {
			if s.re.MatchString(relative) {
				if s.exclude {
					excluded = true
				} else {
					included = true
				}
			}
		}
		for _, entry := range entries {
			if entry.Type()&os.ModeSymlink != 0 {
				continue
			}
			if (!entry.IsDir() && (contains(workspaceMarkers, entry.Name()) || strings.HasSuffix(entry.Name(), ".csproj"))) || entry.Name() == ".git" {
				isProject = true
			}
		}
		if current.depth > 0 && !excluded && (included || current.depth == 1) && isProject {
			folders = append(folders, canonical)
		}
		if current.depth > 0 && len(selectors) == 0 {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || strings.HasPrefix(entry.Name(), ".") || contains(skip, entry.Name()) {
				continue
			}
			if current.depth >= 8 {
				warn("Workspace nesting beyond eight levels was not explored.")
				continue
			}
			if len(visited)+len(pending) >= 2000 {
				warn("Discovery stopped after 2,000 directories.")
				break
			}
			pending = append(pending, directory{filepath.Join(canonical, entry.Name()), current.depth + 1})
		}
	}
	if len(folders) >= 1000 {
		warn("Discovery stopped after 1,000 projects.")
	}
	sort.Strings(folders)
	projects := []Object{}
	names := map[string]bool{}
	for _, folder := range folders {
		manifest := smallManifest(folder)
		name := str(manifest, "name")
		if name == "" {
			name = filepath.Base(folder)
		}
		if names[name] {
			warn("Duplicate package names were found; dependency impact is conservative.")
		}
		names[name] = true
		deps := []string{}
		for _, key := range []string{"dependencies", "devDependencies", "peerDependencies", "optionalDependencies"} {
			for dep := range object(manifest[key]) {
				if !contains(deps, dep) {
					deps = append(deps, dep)
				}
			}
		}
		relative, _ := filepath.Rel(root, folder)
		projects = append(projects, Object{"folderPath": folder, "relativePath": filepath.ToSlash(relative), "name": name, "dependencies": deps, "affected": false, "reasons": []string{}})
	}
	for _, p := range projects {
		deps := []string{}
		for _, d := range stringsOf(p["dependencies"]) {
			if names[d] && d != str(p, "name") {
				deps = append(deps, d)
			}
		}
		sort.Strings(deps)
		p["dependencies"] = deps
	}
	shared := []string{}
	for _, name := range sharedFiles {
		if _, err := os.Stat(filepath.Join(root, name)); err == nil {
			shared = append(shared, name)
		}
	}
	plan := Object{"rootPath": root, "projects": projects, "sharedFiles": shared, "changedFiles": []string{}, "impactAvailable": false, "warnings": warnings}
	diff, err := gitCommand(ctx, root, "diff", "--no-renames", "--name-only", "--relative", "-z", "HEAD", "--", ".")
	untracked, otherErr := gitCommand(ctx, root, "ls-files", "--others", "--exclude-standard", "-z", "--", ".")
	if err != nil || otherErr != nil {
		warn("Change impact is unavailable. Use a Git checkout with an initial commit, and review every project.")
		plan["warnings"] = warnings
		return plan, nil
	}
	changed := []string{}
	for _, f := range strings.Split(diff+untracked, "\x00") {
		if f != "" && !contains(changed, f) {
			changed = append(changed, f)
		}
	}
	sharedChanged := false
	for _, file := range changed {
		matched := false
		for _, p := range projects {
			if strings.HasPrefix(file, str(p, "relativePath")+"/") {
				matched = true
			}
		}
		if !matched {
			sharedChanged = true
		}
	}
	for _, p := range projects {
		reasons := []string{}
		for _, file := range changed {
			if strings.HasPrefix(file, str(p, "relativePath")+"/") {
				reasons = append(reasons, "Uncommitted files changed")
				break
			}
		}
		if sharedChanged {
			reasons = append(reasons, "Root or shared files changed")
		}
		p["reasons"] = reasons
		p["affected"] = len(reasons) > 0
	}
	for {
		changed := false
		affected := map[string]bool{}
		for _, p := range projects {
			if boolean(p["affected"]) {
				affected[str(p, "name")] = true
			}
		}
		for _, p := range projects {
			if boolean(p["affected"]) {
				continue
			}
			for _, dep := range stringsOf(p["dependencies"]) {
				if affected[dep] {
					p["affected"] = true
					p["reasons"] = []string{"Depends on changed package " + dep}
					changed = true
					break
				}
			}
		}
		if !changed {
			break
		}
	}
	plan["changedFiles"] = changed
	plan["impactAvailable"] = true
	plan["warnings"] = warnings
	return plan, nil
}
