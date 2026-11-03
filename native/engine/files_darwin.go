package engine

import (
	"os"
	"syscall"
)

const regularReadFlags = os.O_RDONLY | syscall.O_NONBLOCK
