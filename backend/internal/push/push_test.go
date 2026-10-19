package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestValidateEndpoint(t *testing.T) {
	ok := []string{
		"https://fcm.googleapis.com/fcm/send/abc",
		"https://web.push.apple.com/QGx",
		"https://updates.push.services.mozilla.com/wpush/v2/x",
		"https://wns2-db5p.notify.windows.com/w/?token=x",
	}
	for _, e := range ok {
		if err := ValidateEndpoint(e); err != nil {
			t.Errorf("%s: %v", e, err)
		}
	}
	bad := []string{
		"http://fcm.googleapis.com/fcm/send/abc", // not https
		"https://evilfcm.googleapis.com.attacker.io/x",
		"https://notfcm.googleapis.com.evil/x",
		"https://169.254.169.254/latest/meta-data",
		"https://localhost/x",
		"https://fcm.googleapis.com:8443/x", // explicit port
		"https://user@fcm.googleapis.com/x", // credentials
		"https://attacker.io/?h=push.apple.com",
		"",
		"not a url",
	}
	for _, e := range bad {
		if err := ValidateEndpoint(e); err == nil {
			t.Errorf("%q accepted", e)
		}
	}
}

func TestTopicIsShortAndStable(t *testing.T) {
	a, b := Topic("pj_123"), Topic("pj_123")
	if a != b || len(a) != 32 {
		t.Fatalf("topic %q %q", a, b)
	}
	if Topic("pj_124") == a {
		t.Fatal("topic collision")
	}
}

func TestStatusHelpers(t *testing.T) {
	if !Gone(410) || !Gone(404) || Gone(201) {
		t.Fatal("gone")
	}
	if !Retryable(429) || !Retryable(503) || Retryable(400) {
		t.Fatal("retryable")
	}
}

func TestLibrarySubjectKeepsOneMailto(t *testing.T) {
	// webpush-go prepends "mailto:" to anything that is not https:, so the bare address goes in.
	for in, want := range map[string]string{
		"mailto:jan@example.com": "jan@example.com",
		"jan@example.com":        "jan@example.com",
		"https://example.com/c":  "https://example.com/c",
	} {
		if got := librarySubject(in); got != want {
			t.Errorf("%q -> %q, want %q", in, got, want)
		}
	}
}

func TestServiceName(t *testing.T) {
	for ep, want := range map[string]string{
		"https://web.push.apple.com/Qx":               "Apple",
		"https://fcm.googleapis.com/fcm/send/abc":     "Google",
		"https://updates.push.services.mozilla.com/x": "Mozilla",
		"https://wns2-db5p.notify.windows.com/w/?t=x": "Windows",
		"https://example.org/x":                       "unknown",
	} {
		if got := ServiceName(ep); got != want {
			t.Errorf("%s -> %s, want %s", ep, got, want)
		}
	}
}

type captureTransport struct{ req *http.Request }

func (c *captureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c.req = r
	return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: r}, nil
}

// The push services read the VAPID token's "sub" claim and refuse a bad one (403), so check the
// token that is really sent, for a mailto: contact as the variable is documented.
func TestSendSignsAValidVAPIDSubject(t *testing.T) {
	priv, pub, err := GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	browser, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	sub := Subscription{
		Endpoint: "https://fcm.googleapis.com/fcm/send/abc",
		P256dh:   base64.RawURLEncoding.EncodeToString(browser.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(auth),
	}
	for _, subject := range []string{"mailto:jan@example.com", "https://example.com/contact"} {
		w := NewWebPush(pub, priv, subject)
		ct := &captureTransport{}
		w.client = &http.Client{Transport: ct}
		status, err := w.Send(context.Background(), sub, []byte(`{"title":"x"}`), Options{Topic: Topic("job")})
		if err != nil || status != 201 {
			t.Fatalf("%s: %d %v", subject, status, err)
		}
		authz := ct.req.Header.Get("Authorization")
		tok := strings.TrimPrefix(strings.SplitN(authz, ",", 2)[0], "vapid t=")
		parts := strings.Split(tok, ".")
		if len(parts) != 3 {
			t.Fatalf("authorization %q", authz)
		}
		raw, err := base64.RawURLEncoding.DecodeString(parts[1])
		if err != nil {
			t.Fatal(err)
		}
		var claims struct {
			Sub string `json:"sub"`
			Aud string `json:"aud"`
		}
		if err := json.Unmarshal(raw, &claims); err != nil {
			t.Fatal(err)
		}
		if claims.Sub != subject {
			t.Errorf("sub claim %q, want %q", claims.Sub, subject)
		}
		if claims.Aud != "https://fcm.googleapis.com" {
			t.Errorf("aud claim %q", claims.Aud)
		}
	}
}
