package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func canonicalFolder(folder string) (string, error) {
	if !filepath.IsAbs(folder) {
		return "", errors.New("Choose an absolute source folder")
	}
	real, err := filepath.EvalSymlinks(filepath.Clean(folder))
	if err != nil {
		return "", errors.New("The source folder cannot be accessed")
	}
	info, err := os.Stat(real)
	if err != nil || !info.IsDir() {
		return "", errors.New("Choose a source directory")
	}
	return real, nil
}
func within(root, target string) bool {
	r, err := filepath.Rel(root, target)
	return err == nil && r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator)) && !filepath.IsAbs(r)
}
func (e *Engine) grant(folder string) (string, error) {
	real, err := canonicalFolder(folder)
	if err != nil {
		return "", err
	}
	e.mu.Lock()
	e.folders[strings.ToLower(real)] = true
	e.mu.Unlock()
	return real, nil
}
func (e *Engine) requireFolder(folder string) (string, error) {
	real, err := canonicalFolder(folder)
	if err != nil {
		return "", err
	}
	e.mu.Lock()
	allowed := e.folders[strings.ToLower(real)]
	e.mu.Unlock()
	if !allowed {
		return "", errors.New("Select this source folder through the folder picker first")
	}
	return real, nil
}
func readSnippet(folder, relative string, line int) (Object, error) {
	relative = strings.ReplaceAll(relative, "/", string(filepath.Separator))
	if relative == "" || filepath.IsAbs(relative) || filepath.VolumeName(relative) != "" || strings.HasPrefix(relative, "\\") {
		return nil, errors.New("Invalid source path")
	}
	target, err := filepath.EvalSymlinks(filepath.Join(folder, relative))
	if err != nil || !within(folder, target) {
		return nil, errors.New("Source path is outside the selected folder or inaccessible")
	}
	root, err := os.OpenRoot(folder)
	if err != nil {
		return nil, errors.New("Source folder is inaccessible")
	}
	defer root.Close()
	rel, _ := filepath.Rel(folder, target)
	file, err := root.Open(rel)
	if err != nil {
		return nil, errors.New("Source file is outside the selected folder or inaccessible")
	}
	defer file.Close()
	data, err := readBoundedFile(file, 8<<20)
	if err != nil {
		return nil, errors.New("Source file is unreadable, too large, or not a regular file")
	}
	if strings.ContainsRune(string(data), 0) {
		return nil, errors.New("Binary source files cannot be displayed")
	}
	lines := strings.Split(string(data), "\n")
	line = max(1, min(line, len(lines)))
	from, to := max(0, line-8), min(len(lines), line+7)
	return Object{"path": rel, "startLine": from + 1, "endLine": to, "lines": lines[from:to], "totalLines": len(lines)}, nil
}
func gitCommand(ctx context.Context, folder string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	all := append([]string{"-C", folder, "-c", "core.fsmonitor=false"}, args...)
	cmd := exec.CommandContext(ctx, "git", all...)
	prepareProcess(cmd)
	output := &boundedOutput{limit: 8 << 20, cancel: cancel}
	cmd.Stdout = output
	cmd.WaitDelay = time.Second
	if err := cmd.Run(); err != nil {
		return "", errors.New("Git metadata unavailable")
	}
	return output.data.String(), nil
}
func gitInfo(ctx context.Context, folder string) Object {
	branch, err := gitCommand(ctx, folder, "symbolic-ref", "--quiet", "--short", "HEAD")
	hasGit := err == nil
	if err != nil {
		if _, err = gitCommand(ctx, folder, "rev-parse", "--git-dir"); err == nil {
			hasGit = true
			branch = "HEAD"
		}
	}
	return Object{"branch": strings.TrimSpace(branch), "hasGit": hasGit, "repoName": filepath.Base(folder)}
}
func captureProvenance(ctx context.Context, folder string, options Object, connection, version string) Object {
	source := Object{"folderPath": folder, "branch": str(options, "branch"), "dirty": true, "capturedAt": now(), "snapshot": false, "fingerprintScope": "folder-files"}
	files := []string{}
	before := ""
	root, gitErr := gitCommand(ctx, folder, "rev-parse", "--show-toplevel")
	if gitErr == nil {
		source["repositoryRoot"] = strings.TrimSpace(root)
		commit, _ := gitCommand(ctx, folder, "rev-parse", "--verify", "HEAD")
		source["commit"] = strings.TrimSpace(commit)
		source["branch"] = gitInfo(ctx, folder)["branch"]
		before, gitErr = gitCommand(ctx, folder, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".")
		source["dirty"] = before != ""
		source["fingerprintScope"] = "git-visible-files"
		listed, err := gitCommand(ctx, folder, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".")
		if err != nil {
			gitErr = err
		} else {
			for _, f := range strings.Split(listed, "\x00") {
				if f != "" {
					files = append(files, f)
				}
			}
		}
	}
	captureErr := gitErr
	if str(source, "repositoryRoot") == "" {
		captureErr = nil
		ignored := map[string]bool{}
		for _, s := range defaultExcludes {
			ignored[s] = true
		}
		for _, s := range stringsOf(options["excludes"]) {
			if strings.HasPrefix(s, "!") {
				delete(ignored, s[1:])
			} else if !strings.ContainsAny(s, "?*[]") {
				ignored[strings.TrimSuffix(s, "/")] = true
			}
		}
		captureErr = filepath.WalkDir(folder, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if path == folder {
				return nil
			}
			rel, _ := filepath.Rel(folder, path)
			if ignored[d.Name()] || ignored[filepath.ToSlash(rel)] || d.Name() == ".git" {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.Count(rel, string(filepath.Separator)) > 40 {
				return errors.New("Source fingerprint exceeded directory depth limit")
			}
			if !d.IsDir() {
				files = append(files, rel)
				if len(files) > 20000 {
					return errors.New("Source fingerprint exceeded 20,000 files")
				}
			}
			return nil
		})
	}
	h := sha256.New()
	total := int64(0)
	if len(files) > 20000 {
		captureErr = errors.New("Source fingerprint exceeded 20,000 files")
	}
	if captureErr == nil {
		sort.Strings(files)
		last := ""
		for _, rel := range files {
			if rel == last {
				continue
			}
			last = rel
			if ctx.Err() != nil {
				captureErr = ctx.Err()
				break
			}
			target := filepath.Join(folder, rel)
			if filepath.IsAbs(rel) || !within(folder, target) {
				captureErr = errors.New("Source path escaped the selected folder")
				break
			}
			h.Write(jsonValue(filepath.ToSlash(rel)))
			stat, err := os.Lstat(target)
			if os.IsNotExist(err) {
				h.Write([]byte(":deleted\n"))
				continue
			}
			if err != nil {
				captureErr = errors.New("Source metadata could not be read")
				break
			}
			if stat.Mode()&os.ModeSymlink != 0 {
				link, err := os.Readlink(target)
				if err != nil {
					captureErr = errors.New("Source link could not be read")
					break
				}
				h.Write([]byte(":link:"))
				h.Write(jsonValue(link))
				continue
			}
			resolved, err := filepath.EvalSymlinks(target)
			if err != nil || !within(folder, resolved) {
				captureErr = errors.New("Source link escaped the selected folder")
				break
			}
			if stat.Size() > 16<<20 || total+stat.Size() > 256<<20 {
				captureErr = errors.New("Source fingerprint exceeded its 16 MiB per-file or 256 MiB total limit")
				break
			}
			data, err := readBounded(target, 16<<20)
			after, statErr := os.Stat(target)
			if err != nil || statErr != nil || after.Size() != stat.Size() || !after.ModTime().Equal(stat.ModTime()) || int64(len(data)) != stat.Size() {
				captureErr = errors.New("Source changed or could not be read during fingerprint capture")
				break
			}
			total += int64(len(data))
			fmt.Fprintf(h, ":file:%d:%d:", stat.Mode().Perm(), len(data))
			h.Write(data)
			h.Write([]byte("\n"))
		}
	}
	if captureErr == nil && str(source, "repositoryRoot") != "" {
		after, err := gitCommand(ctx, folder, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".")
		commit, commitErr := gitCommand(ctx, folder, "rev-parse", "--verify", "HEAD")
		if err != nil || before != after || (str(source, "commit") != "" && (commitErr != nil || strings.TrimSpace(commit) != str(source, "commit"))) {
			captureErr = errors.New("Git source changed during fingerprint capture")
		}
	}
	if captureErr == nil {
		source["fingerprint"] = hex.EncodeToString(h.Sum(nil))
		source["capturedFiles"] = len(files)
		source["captureWarning"] = "Fingerprint is bounded local evidence, not an immutable archive or proof of uploaded contents."
	} else {
		source["captureWarning"] = captureErr.Error() + " Source fingerprint is unavailable."
	}
	o := clone(options)
	o["scanners"] = sortedStrings(options["scanners"])
	return Object{"version": 1, "connectionId": connection, "capturedAt": now(), "cliVersion": version, "source": source, "options": o, "optionsFingerprint": hash([]byte(requestedConfig(o))), "requestedScanners": o["scanners"]}
}
