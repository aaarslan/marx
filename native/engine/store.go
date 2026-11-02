package engine

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
	mu sync.Mutex
}

func OpenStore(file string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return nil, errors.New("The workbench directory could not be created")
	}
	info, err := os.Lstat(file)
	if err == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
		return nil, errors.New("The workbench database must be a regular file")
	}
	if err != nil && !os.IsNotExist(err) {
		return nil, errors.New("The workbench database could not be inspected")
	}
	private, err := os.OpenFile(file, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return nil, errors.New("The workbench database could not be opened privately")
	}
	chmodErr := private.Chmod(0600)
	closeErr := private.Close()
	if chmodErr != nil || closeErr != nil {
		return nil, errors.New("The workbench database permissions could not be secured")
	}
	for _, sidecar := range []string{file + "-wal", file + "-shm"} {
		info, err := os.Lstat(sidecar)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil || !info.Mode().IsRegular() {
			return nil, errors.New("Workbench sidecars must be regular files")
		}
		handle, err := os.OpenFile(sidecar, os.O_RDWR, 0600)
		if err != nil {
			return nil, errors.New("Workbench sidecars could not be secured")
		}
		chmodErr := handle.Chmod(0600)
		closeErr := handle.Close()
		if chmodErr != nil || closeErr != nil {
			return nil, errors.New("Workbench sidecar permissions could not be secured")
		}
	}
	db, err := sql.Open("sqlite", file)
	if err != nil {
		return nil, errors.New("The workbench database could not be opened")
	}
	db.SetMaxOpenConns(1)
	fail := func() (*Store, error) {
		db.Close()
		return nil, errors.New("The workbench database is unreadable or uses an unsupported version; it was left in place")
	}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version > 2 {
		return fail()
	}
	// This branch intentionally starts a new storage format; legacy data is not migrated.
	if version == 1 {
		return fail()
	}
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 BEGIN IMMEDIATE;
 CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, scope TEXT NOT NULL, id TEXT NOT NULL, updated INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(kind,scope,id));
 CREATE INDEX IF NOT EXISTS records_order ON records(kind,scope,updated DESC);
 CREATE TABLE IF NOT EXISTS logs(sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, line TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS logs_job ON logs(job_id,sequence);
 PRAGMA user_version=2; COMMIT;`)
	if err != nil {
		return fail()
	}
	return &Store{db: db}, nil
}
func (s *Store) Close() error { return s.db.Close() }

type record struct {
	kind, scope, id string
	value           Object
	immutable       bool
}

func (s *Store) save(records ...record) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, r := range records {
		conflict := "DO UPDATE SET updated=excluded.updated,payload=excluded.payload"
		if r.immutable {
			conflict = "DO NOTHING"
		}
		if _, err = tx.Exec("INSERT INTO records(kind,scope,id,updated,payload) VALUES(?,?,?,?,?) ON CONFLICT(kind,scope,id) "+conflict, r.kind, r.scope, r.id, now(), jsonValue(r.value)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) get(kind, scope, id string) (Object, error) {
	var b []byte
	err := s.db.QueryRow("SELECT payload FROM records WHERE kind=? AND scope=? AND id=?", kind, scope, id).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var m Object
	err = json.Unmarshal(b, &m)
	return m, err
}
func (s *Store) list(kind string, scope *string) ([]Object, error) {
	q := "SELECT payload FROM records WHERE kind=?"
	args := []any{kind}
	if scope != nil {
		q += " AND scope=?"
		args = append(args, *scope)
	}
	q += " ORDER BY updated DESC,id"
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Object{}
	for rows.Next() {
		var b []byte
		var m Object
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(b, &m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func (s *Store) remove(kind, scope, id string) error {
	_, err := s.db.Exec("DELETE FROM records WHERE kind=? AND scope=? AND id=?", kind, scope, id)
	return err
}
func (s *Store) appendLog(id, line string) error {
	if len(line) > 16384 {
		line = line[:16384]
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO logs(job_id,line) VALUES(?,?)", id, line); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM logs WHERE job_id=? AND sequence NOT IN (SELECT sequence FROM logs WHERE job_id=? ORDER BY sequence DESC LIMIT 1000)", id, id); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) logs(id string) ([]string, error) {
	rows, err := s.db.Query("SELECT line FROM logs WHERE job_id=? ORDER BY sequence", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var line string
		if err = rows.Scan(&line); err != nil {
			return nil, err
		}
		out = append(out, line)
	}
	return out, rows.Err()
}
func (s *Store) saveJob(job Object) error {
	return s.save(record{kind: "job", scope: str(job, "connectionId"), id: str(job, "id"), value: job})
}
func (s *Store) saveSnapshot(connection string, page Object) error {
	scan := object(page["scan"])
	id := str(scan, "id")
	findings := objects(page["findings"])
	if connection == "" || id == "" || number(page["totalCount"]) < float64(len(findings)) {
		return errors.New("Invalid scan findings count or identity")
	}
	for _, f := range findings {
		if str(f, "scanId") != id || str(f, "projectId") != str(scan, "projectId") {
			return errors.New("Findings belong to a different scan or project")
		}
	}
	return s.save(record{kind: "snapshot", scope: connection, id: id, value: page})
}
func (s *Store) query(connection, id string, q Object) (Object, error) {
	page, err := s.get("snapshot", connection, id)
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, errors.New("Import this scan before querying findings")
	}
	offset := integer(q["offset"], 0, 0, 1<<30)
	limit := integer(q["limit"], 200, 1, 1000)
	selected := make([]Object, 0, limit)
	count := 0
	scanner, state := str(q, "scanner"), str(q, "state")
	severities := stringsOf(q["severities"])
	search := strings.ToLower(strings.TrimSpace(str(q, "search")))
	for _, item := range array(page["findings"]) {
		f := object(item)
		if scanner != "" && scanner != "ALL" && scanner != str(f, "type") {
			continue
		}
		if state != "" && state != "ALL" && state != str(f, "state") {
			continue
		}
		if len(severities) > 0 && !contains(severities, str(f, "severity")) {
			continue
		}
		if search != "" {
			parts := make([]string, 0, 10)
			for _, key := range []string{"title", "where", "description", "cve", "cwe", "packageName", "packageVersion", "group", "similarityId"} {
				parts = append(parts, str(f, key))
			}
			for _, node := range array(f["flow"]) {
				parts = append(parts, str(object(node), "fileName"))
			}
			if !strings.Contains(strings.ToLower(strings.Join(parts, "\n")), search) {
				continue
			}
		}
		if count >= offset && len(selected) < limit {
			selected = append(selected, f)
		}
		count++
	}
	return Object{"findings": selected, "filteredCount": count, "totalCount": page["totalCount"]}, nil
}
