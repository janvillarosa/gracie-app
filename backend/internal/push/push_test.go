package push

import "testing"

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
