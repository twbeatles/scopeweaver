package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/Autumn-27/artex/agent"
	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/norma/llm"
)

func TestConnectionLocalGatewayCredentialReuse(t *testing.T) {
	t.Setenv("SCOPEWEAVER_CONFIG", filepath.Join(t.TempDir(), "missing.json"))
	t.Setenv("SCOPEWEAVER_LOCAL_LLM_ONLY", "false")
	t.Setenv("SCOPEWEAVER_LOCAL_LLM_ALLOWED_CIDRS", "")
	for _, format := range []string{"anthropic", "openai", "openai-responses"} {
		for _, scenario := range []string{"same normalized endpoint", "different endpoint", "different format", "different proxy", "nonlocal fallback"} {
			t.Run(format+"/"+scenario, func(t *testing.T) {
				targetFormat := format
				if scenario == "different format" {
					targetFormat = "openai"
					if format == "openai" {
						targetFormat = "anthropic"
					}
				}
				wantKey := "scopeweaver-local"
				if scenario == "same normalized endpoint" || scenario == "nonlocal fallback" {
					wantKey = "fixture-active-key"
				}
				var calls atomic.Int32
				handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					path, header, want := "/custom/chat/completions", "Authorization", "Bearer "+wantKey
					if targetFormat == "anthropic" {
						path, header, want = "/custom/v1/messages", "X-Api-Key", wantKey
					} else if targetFormat == "openai-responses" {
						path = "/custom/responses"
					}
					if r.Method != http.MethodPost || r.URL.Path != path || r.Header.Get(header) != want {
						t.Errorf("gateway received %s %s with %s=%q; want POST %s with %q", r.Method, r.URL.Path, header, r.Header.Get(header), path, want)
						http.Error(w, "fixture authentication failed", http.StatusUnauthorized)
						return
					}
					w.Header().Set("Content-Type", "application/json")
					switch targetFormat {
					case "anthropic":
						fmt.Fprint(w, `{"role":"assistant","content":[{"type":"text","text":"OK"}],"stop_reason":"end_turn"}`)
					case "openai":
						fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}`)
					default:
						fmt.Fprint(w, `{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"OK"}]}]}`)
					}
				})
				gateway := httptest.NewServer(handler)
				defer gateway.Close()
				s := &Server{m: &Manager{}, llmCfg: agent.ConfigFrom(format, "fixture-model", gateway.URL+"/custom", "fixture-active-key", "")}
				baseURL, proxy := gateway.URL+"/custom", ""
				if scenario == "different endpoint" || scenario == "different proxy" || scenario == "nonlocal fallback" {
					other := httptest.NewServer(handler)
					defer other.Close()
					if scenario == "different endpoint" {
						baseURL = other.URL + "/custom"
					} else {
						proxy = other.URL
					}
					if scenario == "nonlocal fallback" {
						// The explicit local fixture proxy prevents any public network request.
						baseURL = "http://203.0.113.7/custom"
					}
				}
				if scenario == "same normalized endpoint" {
					suffix := map[string]string{"anthropic": "/v1/messages", "openai": "/chat/completions", "openai-responses": "/responses"}
					baseURL += suffix[targetFormat]
				}
				result := testGatewayConnection(t, s, targetFormat, baseURL, proxy)
				if result["ok"] != true || result["reply"] != "OK" || result["model"] != "fixture-model" || result["latency_ms"] == nil || calls.Load() != 1 {
					t.Fatalf("connection response=%v gateway calls=%d", result, calls.Load())
				}
			})
		}
	}
}

func TestConnectionNativeTargetDoesNotReuseActiveGatewayKey(t *testing.T) {
	t.Setenv("SCOPEWEAVER_CONFIG", filepath.Join(t.TempDir(), "missing.json"))
	t.Setenv("SCOPEWEAVER_LOCAL_LLM_ONLY", "false")
	t.Setenv("SCOPEWEAVER_LOCAL_LLM_ALLOWED_CIDRS", "")
	gateway := nativeFixture(t) // Asserts no Authorization header on every native request.
	s := &Server{m: &Manager{}, llmCfg: agent.ConfigFrom("openai", "fixture-model", gateway.URL, "fixture-active-key", "")}
	result := testGatewayConnection(t, s, "ollama", gateway.URL, "")
	if result["ok"] != true || result["tool_call_verified"] != true || result["context_verified"] != true {
		t.Fatalf("native diagnostics=%v", result)
	}
}

func TestCheaperInferenceCredentialFallbackStaysAtGatewayOrigin(t *testing.T) {
	t.Setenv("SCOPEWEAVER_CONFIG", filepath.Join(t.TempDir(), "missing.json"))
	t.Setenv("SCOPEWEAVER_LOCAL_LLM_ONLY", "false")
	const gateway = "http://api.cheaperinference.com/v1"
	// The URL identifies a nonlocal endpoint. Any attempted HTTP request goes
	// through the loopback fixture proxy and cannot reach a provider.
	const other = "http://203.0.113.7/v1"

	for _, source := range []string{"active", "stored"} {
		t.Run(source, func(t *testing.T) {
			var calls atomic.Int32
			proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Host != "api.cheaperinference.com" || r.Header.Get("Authorization") != "Bearer fixture-gateway-key" {
					t.Error("unexpected proxy destination or authorization")
					http.Error(w, "fixture authentication failed", http.StatusUnauthorized)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				if r.Method == http.MethodGet {
					fmt.Fprint(w, `{"data":[{"id":"fixture-model"}]}`)
				} else {
					fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}`)
				}
			}))
			defer proxy.Close()

			body := map[string]any{"provider": "openai", "model": "fixture-model", "proxy": proxy.URL, "streaming": false}
			s := &Server{m: &Manager{}}
			handlers := map[string]http.HandlerFunc{"connection": s.testLLM}
			if source == "active" {
				s.llmCfg = agent.ConfigFrom("openai", "fixture-model", gateway, "fixture-gateway-key", proxy.URL)
			} else {
				s.m = backportTestManager(t)
				id, err := s.m.pg.SaveProfile(&db.LLMProfile{Name: "gateway-key-scope-test", Format: "openai", BaseURL: gateway, Model: "fixture-model", APIKey: "fixture-gateway-key"})
				if err != nil {
					t.Fatal(err)
				}
				defer s.m.pg.DeleteProfile(id)
				body["profile_id"] = id
				handlers["models"] = s.pgListModels
			}
			for name, h := range handlers {
				t.Run(name, func(t *testing.T) {
					body["base_url"] = other
					before := calls.Load()
					if got := callGatewayHandler(t, h, body); got["ok"] != false || calls.Load() != before {
						t.Fatalf("cross-origin fallback response = %v, proxy calls = %d", got, calls.Load()-before)
					}
					body["base_url"] = gateway
					if source == "stored" {
						body["base_url"] = "http://api.cheaperinference.com/custom"
					}
					if got := callGatewayHandler(t, h, body); got["ok"] != true || calls.Load() != before+1 {
						t.Fatalf("same-origin fallback response = %v, proxy calls = %d", got, calls.Load()-before)
					}
				})
			}
		})
	}
}

func TestConnectionOpenAIMaxTokensField(t *testing.T) {
	t.Setenv("SCOPEWEAVER_CONFIG", filepath.Join(t.TempDir(), "missing.json"))
	t.Setenv("SCOPEWEAVER_LOCAL_LLM_ONLY", "false")
	var lastRequest atomic.Pointer[map[string]any]
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode fixture request: %v", err)
			http.Error(w, "bad fixture request", http.StatusBadRequest)
			return
		}
		lastRequest.Store(&body)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}`)
	}))
	defer fixture.Close()
	s := &Server{m: &Manager{}}

	check := func(t *testing.T, input map[string]any, wantField string) {
		t.Helper()
		if got := callGatewayHandler(t, s.testLLM, input); got["ok"] != true {
			t.Fatalf("connection response = %v", got)
		}
		otherField := "max_tokens"
		if wantField == otherField {
			otherField = llm.MaxTokensFieldCompletion
		}
		wire := lastRequest.Swap(nil)
		if wire == nil {
			t.Fatal("connection succeeded without a request to the fixture")
		}
		_, hasOtherField := (*wire)[otherField]
		if (*wire)[wantField] != float64(8192) || hasOtherField {
			t.Fatalf("wire token fields = %v, %v; want only %s = 8192", (*wire)[wantField], (*wire)[otherField], wantField)
		}
	}

	for _, tc := range []struct{ name, submitted, want string }{
		{"submitted override", llm.MaxTokensFieldCompletion, llm.MaxTokensFieldCompletion},
		{"legacy omitted field", "", "max_tokens"},
		{"unknown value", "max_output_tokens", "max_tokens"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := map[string]any{"provider": "openai", "model": "gpt-5.4-mini", "base_url": fixture.URL, "streaming": false, "max_tokens": 16384}
			if tc.submitted != "" {
				body["max_tokens_field"] = tc.submitted
			}
			check(t, body, tc.want)
		})
	}
	t.Run("saved profile", func(t *testing.T) {
		s.m = backportTestManager(t)
		id, err := s.m.pg.SaveProfile(&db.LLMProfile{Name: "gateway-saved-token-field", Format: "openai", BaseURL: fixture.URL, Model: "gpt-5.4-mini", MaxTokensField: llm.MaxTokensFieldCompletion})
		if err != nil {
			t.Fatal(err)
		}
		defer s.m.pg.DeleteProfile(id)
		body := map[string]any{"provider": "openai", "model": "gpt-5.4-mini", "base_url": fixture.URL + "/chat/completions", "streaming": false, "profile_id": id}
		check(t, body, llm.MaxTokensFieldCompletion)
		body["model"] = "other-model"
		check(t, body, "max_tokens")
		body["model"] = "gpt-5.4-mini"
		body["max_tokens_field"] = ""
		check(t, body, "max_tokens")
	})
}

func testGatewayConnection(t *testing.T, s *Server, format, baseURL, proxy string) map[string]any {
	t.Helper()
	model := "fixture-model"
	if format == "ollama" {
		model = "test:latest"
	}
	return callGatewayHandler(t, s.testLLM, map[string]any{"provider": format, "model": model, "base_url": baseURL, "proxy": proxy, "api_key": "", "streaming": false})
}

func callGatewayHandler(t *testing.T, h http.HandlerFunc, body map[string]any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	h(response, httptest.NewRequest(http.MethodPost, "/api/llm/test", bytes.NewReader(raw)))
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != http.StatusOK {
		t.Fatalf("HTTP %d response=%s decode error=%v", response.Code, response.Body, err)
	}
	return result
}
