package main

import (
	"errors"
	"testing"
)

func TestDialogSelectionCancellation(t *testing.T) {
	canceled := errors.New("cancelled by user")
	failure := errors.New("dialog unavailable")
	for _, test := range []struct {
		name     string
		selected string
		err      error
		want     error
	}{
		{"canceled", "", canceled, nil},
		{"empty", "", nil, nil},
		{"failure", "", failure, failure},
		{"selection with error", "synthetic.json", canceled, canceled},
		{"selected", "synthetic.json", nil, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := dialogSelectionError(test.selected, test.err); got != test.want {
				t.Fatalf("Unexpected selection error: %v", got)
			}
		})
	}
}
