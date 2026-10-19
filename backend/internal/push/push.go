// Package push sends Web Push messages (RFC 8030, VAPID RFC 8292, aes128gcm RFC 8291) to the
// browsers' push services: FCM for Chrome and Android, APNs for Safari and iOS Home Screen apps,
// Mozilla's for Firefox. It knows nothing about Bauhouse: services decide who gets what.
package push

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// Subscription is what the browser's PushManager.subscribe() returned.
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// Message is the JSON the service worker reads in its push handler.
type Message struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
}

// Options are per-message delivery settings.
type Options struct {
	// Topic replaces an undelivered message with the same topic (a retry does not stack).
	Topic string
	// TTL is how long the push service keeps the message for an offline device.
	TTL time.Duration
}

// Sender delivers one encrypted message. It returns the push service's HTTP status: 201 sent,
// 404/410 the subscription is gone, 429/5xx try later.
type Sender interface {
	Send(ctx context.Context, sub Subscription, payload []byte, opts Options) (int, error)
}

// Gone reports whether the status means the subscription no longer exists.
func Gone(status int) bool { return status == http.StatusNotFound || status == http.StatusGone }

// Retryable reports whether the status means the push service wants us to try later.
func Retryable(status int) bool { return status == http.StatusTooManyRequests || status >= 500 }

// pushHosts are the push services a subscription may point at. Anything else is refused, so a
// client cannot make the server send requests to hosts of its choosing (SSRF).
var pushHosts = []string{
	"fcm.googleapis.com",
	"android.googleapis.com",
	"push.apple.com",
	"push.services.mozilla.com",
	"notify.windows.com",
}

// ErrEndpoint is returned for an endpoint that is not an https URL at a known push service.
var ErrEndpoint = errors.New("push: endpoint is not a known push service")

// ValidateEndpoint accepts only https URLs on a known push service host (or a subdomain of one).
func ValidateEndpoint(endpoint string) error {
	if len(endpoint) > 1024 {
		return ErrEndpoint
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return ErrEndpoint
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range pushHosts {
		if host == h || strings.HasSuffix(host, "."+h) {
			return nil
		}
	}
	return ErrEndpoint
}

// ServiceName names the push service behind an endpoint, for people reading a test result.
func ServiceName(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return "unknown"
	}
	host := strings.ToLower(u.Hostname())
	switch {
	case strings.HasSuffix(host, "push.apple.com"):
		return "Apple"
	case strings.HasSuffix(host, "googleapis.com"):
		return "Google"
	case strings.HasSuffix(host, "mozilla.com"):
		return "Mozilla"
	case strings.HasSuffix(host, "notify.windows.com"):
		return "Windows"
	}
	return "unknown"
}

// Topic derives a valid Topic header (at most 32 URL-safe base64 characters) from any id.
func Topic(id string) string {
	sum := sha256.Sum256([]byte(id))
	return base64.RawURLEncoding.EncodeToString(sum[:])[:32]
}

// WebPush sends with VAPID keys through the webpush-go library.
type WebPush struct {
	public, private, subject string
	client                   *http.Client
}

// librarySubject adapts a VAPID contact for webpush-go, which puts "mailto:" in front of anything
// that is not an https: URL. A mailto: address must therefore go in bare, or the token's subject
// reads "mailto:mailto:..." and the push services refuse it (403).
func librarySubject(subject string) string { return strings.TrimPrefix(subject, "mailto:") }

// NewWebPush builds a sender. subject is a mailto: or https: contact for the push services.
func NewWebPush(publicKey, privateKey, subject string) *WebPush {
	return &WebPush{public: publicKey, private: privateKey, subject: librarySubject(subject), client: &http.Client{
		Timeout: 10 * time.Second,
		// Never follow a redirect: the endpoint was validated, its redirect target was not.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// PublicKey is the VAPID application server key the browser subscribes with.
func (w *WebPush) PublicKey() string { return w.public }

func (w *WebPush) Send(ctx context.Context, sub Subscription, payload []byte, opts Options) (int, error) {
	if err := ValidateEndpoint(sub.Endpoint); err != nil {
		return 0, err
	}
	ttl := int(opts.TTL / time.Second)
	if ttl <= 0 {
		ttl = int((24 * time.Hour) / time.Second)
	}
	res, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		HTTPClient:      w.client,
		Subscriber:      w.subject,
		VAPIDPublicKey:  w.public,
		VAPIDPrivateKey: w.private,
		TTL:             ttl,
		Topic:           opts.Topic,
		Urgency:         webpush.UrgencyNormal,
	})
	if err != nil {
		return 0, err
	}
	defer func() { _ = res.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	return res.StatusCode, nil
}

// GenerateKeys returns a new VAPID key pair (base64url), for cmd/gen-vapid.
func GenerateKeys() (privateKey, publicKey string, err error) {
	return webpush.GenerateVAPIDKeys()
}
