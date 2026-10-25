# GitScope

GitScope is a small, dependency-free GitHub profile explorer. It runs in the
browser and reads public information from GitHub's REST API; there is no app
server and no token is needed for a first look.

## Run it

From this directory, start any static file server, for example:

```bash
python -m http.server 4173
```

Then open `http://localhost:4173`. You can share a profile directly with a URL
such as `http://localhost:4173/?user=torvalds`.

## Explore

- Search a username or choose a notable profile. Recent searches stay in local
  browser storage.
- Browse and filter repositories, then open a repository to read its README.
- Compare repository stars, forks, watchers, open issues, primary languages,
  and public events. The contribution-style heatmap is an estimate based on the
  public events endpoint (up to the latest 90 days returned by GitHub), not the
  private contribution calendar.
- Switch between dark and light themes; the preference stays local.

GitHub's anonymous REST API quota is limited to 60 requests per hour. If it is
reached, the app offers an optional token field. A saved token is kept in this browser's local storage
and sent only as an authorization header to `api.github.com`; remove it from
the same dialog at any time. The README renderer escapes source text and only
renders a small safe subset of Markdown.

## Limits

GitHub returns at most 100 repositories per request; GitScope follows pages to
load the complete public repository list, so very large accounts can use many
API requests. The public events API exposes a limited, recent window, so
activity and heatmap totals are not a complete lifetime history. Language mix
counts each repository's primary language rather than measuring source-code
bytes.
