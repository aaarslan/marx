package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestSourcePipesAreRejectedBeforeBlocking(t *testing.T) {
	for _, test := range []struct {
		name string
		read func(string, string) error
	}{
		{"configuration", func(_ string, path string) error {
			_, err := readBounded(path, 1<<20)
			return err
		}},
		{"source snippet", func(root, path string) error {
			_, err := readSnippet(root, filepath.Base(path), 1)
			return err
		}},
		{"source fingerprint", func(root, _ string) error {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			result := captureProvenance(ctx, root, Object{}, "synthetic-connection", "synthetic-cli")
			if str(object(result["source"]), "fingerprint") == "" {
				return errors.New("Fingerprint unavailable for a nonregular file")
			}
			return nil
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "source.pipe")
			if err := syscall.Mkfifo(path, 0600); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- test.read(root, path) }()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("A named pipe was accepted as source content")
				}
			case <-time.After(3 * time.Second):
				if writer, err := os.OpenFile(path, os.O_WRONLY|syscall.O_NONBLOCK, 0); err == nil {
					writer.Close()
				}
				<-done
				t.Fatal("A named pipe blocked source inspection")
			}
		})
	}
}
