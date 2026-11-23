package db

import (
	"errors"
	"fmt"
	"testing"
)

func TestProfileCredentialTransitions(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	cases := []struct{ name, oldFormat, oldURL, newFormat, newURL, key, want string }{
		{"SDK same endpoint", "opencode-sdk", "http://localhost:4097/a", "opencode-sdk", "http://localhost:4097/a/", "", "old-token"},
		{"SDK default port casing", "opencode-sdk", "HTTP://LOCALHOST:80/a/", "opencode-sdk", "http://localhost/a", "", "old-token"},
		{"SDK different path", "opencode-sdk", "http://localhost:4097/a", "opencode-sdk", "http://localhost:4097/b", "", ""},
		{"SDK different host alias", "opencode-sdk", "http://localhost:4097", "opencode-sdk", "http://127.0.0.1:4097", "", ""},
		{"SDK different port", "opencode-sdk", "http://localhost:4097", "opencode-sdk", "http://localhost:4098", "", ""},
		{"SDK to cloud", "opencode-sdk", "http://localhost:4097", "openai", "https://api.openai.com/v1", "", ""},
		{"cloud to SDK", "openai", "https://api.openai.com/v1", "opencode-sdk", "http://localhost:4097", "", ""},
		{"SDK explicit replacement", "opencode-sdk", "http://localhost:4097/a", "opencode-sdk", "http://localhost:4097/b", "new-token", "new-token"},
		{"cloud unchanged behavior", "openai", "https://one.example/v1", "openai", "https://two.example/v1", "", "old-token"},
		{"cloud to Cheaper Inference", "openai", "https://api.openai.com/v1", "openai", "https://api.cheaperinference.com/v1", "", ""},
		{"Cheaper Inference to cloud", "openai", "https://api.cheaperinference.com/v1", "openai", "", "", ""},
		{"Cheaper Inference same origin", "openai", "https://api.cheaperinference.com/v1", "openai", "https://API.CHEAPERINFERENCE.COM.:443/custom", "", "old-token"},
		{"Cheaper Inference different scheme", "openai", "https://api.cheaperinference.com/v1", "openai", "http://api.cheaperinference.com/v1", "", ""},
		{"Cheaper Inference different port", "openai", "https://api.cheaperinference.com/v1", "openai", "https://api.cheaperinference.com:8443/v1", "", ""},
		{"Cheaper Inference explicit replacement", "openai", "https://api.openai.com/v1", "openai", "https://api.cheaperinference.com/v1", "new-token", "new-token"},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := &LLMProfile{Name: fmt.Sprintf("credential-transition-%d", i), Format: tc.oldFormat, BaseURL: tc.oldURL, Model: "opencode/test", APIKey: "old-token", Streaming: true}
			id, e := d.SaveProfile(p)
			if e != nil {
				t.Fatal(e)
			}
			defer d.Exec(`DELETE FROM llm_profiles WHERE id=$1`, id)
			p.ID = id
			p.Format = tc.newFormat
			p.BaseURL = tc.newURL
			p.APIKey = tc.key
			p.APIKeyHint = "stale-hint"
			if _, e = d.SaveProfile(p); e != nil {
				t.Fatal(e)
			}
			got, e := d.ProfileByID(id)
			if e != nil {
				t.Fatal(e)
			}
			var savedHint string
			if e = d.QueryRow(`SELECT COALESCE(api_key_hint,'') FROM llm_profiles WHERE id=$1`, id).Scan(&savedHint); e != nil {
				t.Fatal(e)
			}
			wantHint := ""
			if tc.want != "" {
				wantHint = "…" + tc.want[len(tc.want)-4:]
			}
			if got.APIKey != tc.want || savedHint != wantHint || got.Format != tc.newFormat || got.BaseURL != tc.newURL {
				t.Fatalf("saved=%+v want key=%q hint=%q", got, tc.want, wantHint)
			}
		})
	}
}

func TestActiveGatewayCredentialTransitionRequiresKey(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	previousActive, err := d.ActiveProfile()
	if err != nil {
		t.Fatal(err)
	}
	if previousActive != nil {
		defer d.SetActiveProfile(previousActive.ID)
	}

	const gateway = "https://api.cheaperinference.com/v1"
	for _, tc := range []struct {
		name, format, target, key string
		wantError                 bool
	}{
		{"cloud default needs a key", "openai", "", "", true},
		{"whitespace is not a key", "openai", "", " 	 ", true},
		{"SDK bridge needs a key", "opencode-sdk", "http://127.0.0.1:4097", "", true},
		{"local API can be keyless", "openai", "http://127.0.0.1:8080/v1", "", false},
		{"Ollama can be keyless", "ollama", "http://127.0.0.1:11434", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &LLMProfile{Name: "active-gateway-scope", Format: "openai", BaseURL: gateway, Model: "opencode/test", APIKey: "old-token"}
			id, err := d.SaveProfile(p)
			if err != nil {
				t.Fatal(err)
			}
			defer d.Exec(`DELETE FROM llm_profiles WHERE id=$1`, id)
			if err := d.SetActiveProfile(id); err != nil {
				t.Fatal(err)
			}

			p.ID, p.Format, p.BaseURL, p.APIKey = id, tc.format, tc.target, tc.key
			_, err = d.SaveProfile(p)
			wantFormat, wantURL, wantKey, wantHint := tc.format, tc.target, "", ""
			if tc.wantError {
				if !errors.Is(err, ErrActiveLLMProfileKeyRequired) {
					t.Fatalf("save error = %v, want active profile key required", err)
				}
				wantFormat, wantURL, wantKey, wantHint = "openai", gateway, "old-token", "…oken"
			} else if err != nil {
				t.Fatal(err)
			}

			got, err := d.ActiveProfile()
			if err != nil || got == nil {
				t.Fatalf("active profile = %v, err = %v", got, err)
			}
			var hint string
			if err := d.QueryRow(`SELECT COALESCE(api_key_hint,'') FROM llm_profiles WHERE id=$1`, id).Scan(&hint); err != nil {
				t.Fatal(err)
			}
			if got.ID != id || got.Format != wantFormat || got.BaseURL != wantURL || got.APIKey != wantKey || hint != wantHint {
				t.Fatalf("active credential or endpoint differs from expected state: id=%d format=%q url=%q hint=%q", got.ID, got.Format, got.BaseURL, hint)
			}
		})
	}
}

func TestSDKFormatUpgradePreservesExistingProfiles(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	old := &LLMProfile{Name: "sdk-upgrade-existing", Format: "openai", Model: "existing-model", BaseURL: "https://existing.example/v1", APIKey: "existing-key"}
	id, err := d.SaveProfile(old)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Exec(`DELETE FROM llm_profiles WHERE id=$1`, id)
	// Recreate the previous release's constraint only inside this disposable test database.
	if _, err = d.Exec(`ALTER TABLE llm_profiles DROP CONSTRAINT llm_profiles_format_check; ALTER TABLE llm_profiles ADD CONSTRAINT llm_profiles_format_check CHECK (format IN ('openai','anthropic','openai-responses','ollama'))`); err != nil {
		t.Fatal(err)
	}
	sdk := &LLMProfile{Name: "sdk-upgrade-new", Format: "opencode-sdk", Model: "opencode/test", BaseURL: "http://localhost:4097", APIKey: "sdk-token"}
	if _, err = d.SaveProfile(sdk); err == nil {
		t.Fatal("previous schema unexpectedly accepted SDK format")
	}
	upgraded, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	sdkID, err := upgraded.SaveProfile(sdk)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Exec(`DELETE FROM llm_profiles WHERE id=$1`, sdkID)
	got, err := upgraded.ProfileByID(id)
	if err != nil || got.APIKey != old.APIKey || got.Format != old.Format || got.Model != old.Model || got.BaseURL != old.BaseURL {
		t.Fatalf("existing profile changed: %+v err=%v", got, err)
	}
}
