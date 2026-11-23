package llmnet

import "testing"

func TestCrossesCheaperInferenceOrigin(t *testing.T) {
	const gateway = "https://api.cheaperinference.com/v1"
	tests := []struct {
		name          string
		previous      string
		next          string
		wantCrossings bool
	}{
		{"paths", gateway, "https://api.cheaperinference.com/custom", false},
		{"HTTPS default port and host casing", gateway, " HTTPS://API.CHEAPERINFERENCE.COM..:00443/custom ", false},
		{"HTTP default port", "http://api.cheaperinference.com/v1", "http://api.cheaperinference.com:80", false},
		{"internationalized hostname", gateway, "https://api。cheaperinference。com/v1", false},
		{"scheme", gateway, "http://api.cheaperinference.com/v1", true},
		{"port", gateway, "https://api.cheaperinference.com:8443/v1", true},
		{"other provider", gateway, "https://other.example/v1", true},
		{"implicit provider default", gateway, "", true},
		{"non HTTP destination", gateway, "ftp://api.cheaperinference.com/v1", true},
		{"lookalike suffix", "https://api.cheaperinference.com.example/v1", "https://other.example/v1", false},
		{"unrelated providers", "https://one.example/v1", "http://two.example/v2", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := CrossesCheaperInferenceOrigin(tc.previous, tc.next); got != tc.wantCrossings {
				t.Errorf("forward crossing = %t, want %t", got, tc.wantCrossings)
			}
			if got := CrossesCheaperInferenceOrigin(tc.next, tc.previous); got != tc.wantCrossings {
				t.Errorf("reverse crossing = %t, want %t", got, tc.wantCrossings)
			}
		})
	}
}
