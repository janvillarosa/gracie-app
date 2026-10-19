// Command gen-vapid prints a new VAPID key pair for Web Push, as the env vars the server reads.
// Keep the private key secret (a Railway variable); changing the pair invalidates every device.
package main

import (
	"fmt"
	"log"

	"github.com/janvillarosa/gracie-app/backend/internal/push"
)

func main() {
	priv, pub, err := push.GenerateKeys()
	if err != nil {
		log.Fatalf("gen-vapid: %v", err)
	}
	fmt.Printf("VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\n", pub, priv)
}
