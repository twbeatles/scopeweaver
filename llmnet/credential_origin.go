package llmnet

import (
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/net/idna"
)

const cheaperInferenceHost = "api.cheaperinference.com"

// CrossesCheaperInferenceOrigin reports whether a destination change must discard a
// Cheaper Inference key or the key from the previous endpoint. Paths do not change origin.
func CrossesCheaperInferenceOrigin(previousURL, nextURL string) bool {
	previous, next := parseEndpointOrigin(previousURL), parseEndpointOrigin(nextURL)
	return (previous.host == cheaperInferenceHost || next.host == cheaperInferenceHost) && previous != next
}

type endpointOrigin struct {
	scheme string
	host   string
	port   uint16
}

func parseEndpointOrigin(raw string) endpointOrigin {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return endpointOrigin{}
	}
	host, err := idna.Lookup.ToASCII(u.Hostname())
	host = strings.TrimRight(strings.ToLower(host), ".")
	if err != nil || host == "" {
		return endpointOrigin{}
	}
	port := uint64(443)
	if u.Scheme == "http" {
		port = 80
	}
	if value := u.Port(); value != "" {
		port, err = strconv.ParseUint(value, 10, 16)
		if err != nil {
			return endpointOrigin{}
		}
	}
	return endpointOrigin{scheme: u.Scheme, host: host, port: uint16(port)}
}
