package engine

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func BenchmarkFindingsQuery(b *testing.B) {
	store, err := OpenStore(filepath.Join(b.TempDir(), "bench.sqlite"))
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()
	findings := make([]Object, 5051)
	for i := range findings {
		findings[i] = Object{"id": fmt.Sprint(i), "scanId": "s1", "projectId": "p1", "type": "sast", "severity": "HIGH", "state": "TO_VERIFY", "title": "SQL injection", "where": "src/queries.ts:14", "description": strings.Repeat("Synthetic finding evidence. ", 40), "flow": []Object{{"fileName": "src/queries.ts"}}}
	}
	if err = store.saveSnapshot("connection", Object{"scan": Object{"id": "s1", "projectId": "p1"}, "findings": findings, "totalCount": len(findings)}); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		page, err := store.query("connection", "s1", Object{"limit": 100})
		if err != nil || len(objects(page["findings"])) != 100 {
			b.Fatal("Finding query failed", err)
		}
	}
}
