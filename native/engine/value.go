package engine

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// Object is the versioned JSON contract shared with the renderer.
type Object = map[string]any

func object(v any) Object {
	if m, ok := v.(map[string]any); ok && m != nil {
		return m
	}
	return Object{}
}
func array(v any) []any {
	switch a := v.(type) {
	case []any:
		if a != nil {
			return a
		}
	case []Object:
		r := make([]any, len(a))
		for i := range a {
			r[i] = a[i]
		}
		return r
	case []string:
		r := make([]any, len(a))
		for i := range a {
			r[i] = a[i]
		}
		return r
	}
	return []any{}
}
func text(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func number(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}
func boolean(v any) bool            { b, _ := v.(bool); return b }
func str(m Object, k string) string { return text(m[k]) }
func objects(v any) []Object {
	a := array(v)
	r := make([]Object, 0, len(a))
	for _, v := range a {
		r = append(r, object(v))
	}
	return r
}
func stringsOf(v any) []string {
	r := []string{}
	for _, v := range array(v) {
		if s, ok := v.(string); ok {
			r = append(r, s)
		}
	}
	return r
}
func jsonValue(v any) []byte { b, _ := json.Marshal(v); return b }
func clone(m Object) Object {
	var r Object
	_ = json.Unmarshal(jsonValue(m), &r)
	if r == nil {
		return Object{}
	}
	return r
}
func now() int64 { return time.Now().UnixMilli() }
func uuid() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func hash(v []byte) string { h := sha256.Sum256(v); return hex.EncodeToString(h[:]) }
func bounded(v any, name string, max int) (string, error) {
	s, ok := v.(string)
	if !ok || len(s) > max {
		return "", fmt.Errorf("%s must be text under %d bytes", name, max)
	}
	return s, nil
}
func identifier(v any) (string, error) {
	s, err := bounded(v, "Identity", 256)
	if err != nil || strings.TrimSpace(s) == "" || strings.ContainsAny(s, "\x00\r\n") {
		return "", errors.New("A valid identity is required")
	}
	return s, nil
}
func integer(v any, fallback, min, max int) int {
	if v == nil {
		return fallback
	}
	n := number(v)
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return fallback
	}
	return int(math.Max(float64(min), math.Min(float64(max), math.Floor(n))))
}
func contains(a []string, v string) bool {
	for _, s := range a {
		if s == v {
			return true
		}
	}
	return false
}
func status(v any) string {
	s := strings.ToLower(strings.TrimSpace(text(v)))
	if s == "new" {
		return "Queued"
	}
	for _, v := range []string{"Queued", "Running", "Completed", "Partial", "Canceled", "Failed"} {
		if strings.ToLower(v) == s {
			return v
		}
	}
	return "Unknown"
}
func terminal(s string) bool {
	return contains([]string{"Completed", "Partial", "Canceled", "Failed"}, s)
}

var severityOrder = map[string]int{"UNKNOWN": 6, "INFO": 1, "LOW": 2, "MEDIUM": 3, "HIGH": 4, "CRITICAL": 5}
