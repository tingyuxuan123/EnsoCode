package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	checksumsName         = "enso-relay-checksums.txt"
	defaultUpdateRepo     = "tingyuxuan123/EnsoCode"
	defaultUpdateAPI      = "https://api.github.com"
	defaultUpdateInterval = 4 * time.Hour
	minUpdateInterval     = time.Minute
	maxReleaseJSON        = 1 << 20
	maxChecksums          = 64 << 10
	maxBinary             = 64 << 20
)

type selfUpdater struct {
	current  string
	repo     string
	apiBase  string
	token    string
	goos     string
	goarch   string
	exe      string
	client   *http.Client
	log      *slog.Logger
	interval time.Duration
}

type githubRelease struct {
	TagName string        `json:"tag_name"`
	Assets  []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

func newSelfUpdater(log *slog.Logger) *selfUpdater {
	exe, err := os.Executable()
	if err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
	} else {
		exe = ""
	}
	if log == nil {
		log = slog.Default()
	}
	return &selfUpdater{
		current:  version,
		repo:     envOr("RELAY_UPDATE_REPO", defaultUpdateRepo),
		apiBase:  strings.TrimRight(envOr("RELAY_UPDATE_API", defaultUpdateAPI), "/"),
		token:    strings.TrimSpace(os.Getenv("RELAY_GITHUB_TOKEN")),
		goos:     runtime.GOOS,
		goarch:   runtime.GOARCH,
		exe:      exe,
		client:   &http.Client{Timeout: 2 * time.Minute},
		log:      log,
		interval: defaultUpdateInterval,
	}
}

func versionNewer(current, latest string) bool {
	c, okc := parseSemver(current)
	l, okl := parseSemver(latest)
	if !okc || !okl {
		return false
	}
	for i := 0; i < 3; i++ {
		if l[i] > c[i] {
			return true
		}
		if l[i] < c[i] {
			return false
		}
	}
	return false
}

func parseSemver(v string) ([3]int, bool) {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	if v == "" || strings.EqualFold(v, "dev") {
		return [3]int{}, false
	}
	if i := strings.IndexAny(v, "+-"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) == 0 || len(parts) > 3 {
		return [3]int{}, false
	}
	var out [3]int
	for i, p := range parts {
		if p == "" {
			return [3]int{}, false
		}
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return [3]int{}, false
		}
		out[i] = n
	}
	return out, true
}

func relayAssetName(goos, goarch string) string {
	return "enso-relay-" + goos + "-" + goarch
}

func parseChecksums(body []byte) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		sum := strings.ToLower(fields[0])
		if !isSHA256Hex(sum) {
			continue
		}
		name := strings.TrimPrefix(fields[len(fields)-1], "*")
		name = filepath.Base(name)
		if name == "" || name == "." || name == string(filepath.Separator) {
			continue
		}
		out[name] = sum
	}
	return out
}

func isSHA256Hex(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < 64; i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

func exeUpdatable(exe string) bool {
	if strings.TrimSpace(exe) == "" {
		return false
	}
	return !strings.Contains(strings.ToLower(filepath.ToSlash(exe)), "go-build")
}

func envBool(key string, fallback bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	switch strings.ToLower(v) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func envDuration(key string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d < minUpdateInterval {
		return fallback
	}
	return d
}

func stripUpdateFlag(argv []string) []string {
	out := make([]string, 0, len(argv))
	for _, a := range argv {
		if a == "--update" || a == "-update" || strings.HasPrefix(a, "--update=") || strings.HasPrefix(a, "-update=") {
			continue
		}
		out = append(out, a)
	}
	return out
}

func replaceExecutable(target string, data []byte) error {
	dir := filepath.Dir(target)
	f, err := os.CreateTemp(dir, ".enso-relay-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmp)
		}
	}()
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Chmod(0o755); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, target); err != nil {
		return err
	}
	ok = true
	return nil
}

func (u *selfUpdater) checkAndApply(ctx context.Context) (bool, error) {
	if _, ok := parseSemver(u.current); !ok {
		return false, nil
	}
	rel, err := u.fetchLatest(ctx)
	if err != nil {
		return false, err
	}
	if !versionNewer(u.current, rel.TagName) {
		return false, nil
	}
	assetName := relayAssetName(u.goos, u.goarch)
	var bin, sums *githubAsset
	for i := range rel.Assets {
		a := &rel.Assets[i]
		switch a.Name {
		case assetName:
			bin = a
		case checksumsName:
			sums = a
		}
	}
	if bin == nil {
		return false, fmt.Errorf("release %s missing %s", rel.TagName, assetName)
	}
	if sums == nil {
		return false, fmt.Errorf("release %s missing %s", rel.TagName, checksumsName)
	}
	sumBody, err := u.get(ctx, sums.URL, "application/octet-stream", maxChecksums)
	if err != nil {
		return false, err
	}
	want, ok := parseChecksums(sumBody)[assetName]
	if !ok {
		return false, fmt.Errorf("no checksum for %s", assetName)
	}
	data, err := u.get(ctx, bin.URL, "application/octet-stream", maxBinary)
	if err != nil {
		return false, err
	}
	sum := sha256.Sum256(data)
	got := hex.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		return false, fmt.Errorf("checksum mismatch for %s", assetName)
	}
	if u.exe == "" {
		return false, fmt.Errorf("missing executable path")
	}
	if err := replaceExecutable(u.exe, data); err != nil {
		return false, err
	}
	u.log.Info("updated", "from", u.current, "to", rel.TagName)
	return true, nil
}

func (u *selfUpdater) loop(ctx context.Context, onApplied func()) {
	if u.applyOnce(ctx, onApplied) {
		return
	}
	if u.interval <= 0 {
		return
	}
	t := time.NewTicker(u.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if u.applyOnce(ctx, onApplied) {
				return
			}
		}
	}
}

func (u *selfUpdater) applyOnce(ctx context.Context, onApplied func()) bool {
	applied, err := u.checkAndApply(ctx)
	if err != nil {
		u.log.Warn("update check failed", "err", err)
		return false
	}
	if applied {
		onApplied()
		return true
	}
	return false
}

func (u *selfUpdater) restart(argv, env []string) error {
	if u.exe == "" {
		return fmt.Errorf("missing executable path")
	}
	argv = stripUpdateFlag(argv)
	if len(argv) == 0 {
		argv = []string{u.exe}
	}
	return syscall.Exec(u.exe, argv, env)
}

func (u *selfUpdater) fetchLatest(ctx context.Context) (*githubRelease, error) {
	raw := u.apiBase + "/repos/" + u.repo + "/releases/latest"
	body, err := u.get(ctx, raw, "application/vnd.github+json", maxReleaseJSON)
	if err != nil {
		return nil, err
	}
	var rel githubRelease
	if err := json.Unmarshal(body, &rel); err != nil {
		return nil, err
	}
	if strings.TrimSpace(rel.TagName) == "" {
		return nil, fmt.Errorf("release missing tag_name")
	}
	return &rel, nil
}

func (u *selfUpdater) get(ctx context.Context, raw, accept string, max int64) ([]byte, error) {
	if !u.allowedURL(raw) {
		return nil, fmt.Errorf("blocked download host")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "enso-relay/"+u.current)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	if u.token != "" {
		req.Header.Set("Authorization", "Bearer "+u.token)
	}
	res, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
		return nil, fmt.Errorf("http %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, fmt.Errorf("response too large")
	}
	return data, nil
}

func (u *selfUpdater) allowedURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "github.com" || strings.HasSuffix(host, ".githubusercontent.com") {
		return parsed.Scheme == "https"
	}
	api, err := url.Parse(u.apiBase)
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Host, api.Host)
}
