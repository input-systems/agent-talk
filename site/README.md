# Agent Talk site

Builds the static spec site served at `https://talk.input.so`.

## Build

```sh
pnpm site:build                              # noindex build (default)
AGENT_TALK_SITE_NOINDEX=0 pnpm site:build    # launch build, indexable
```

`site/build.ts` runs directly on Node 25 (type stripping). It reads `spec/`, renders the markdown with `marked`, applies `site/template.html` and `site/style.css`, and writes `site/dist/`. It prints warnings for relative links it cannot map, links to a missing schema or vector file, and links to a heading that does not exist.

| Source                  | URL                                       |
| ----------------------- | ----------------------------------------- |
| `spec/agent-talk.md`    | `https://talk.input.so/`                  |
| `spec/a2a-extension.md` | `https://talk.input.so/v1/` (A2A URI)     |
| `spec/schemas/*.json`   | `https://talk.input.so/v1/schemas/<file>` |
| `spec/vectors/*.json`   | `https://talk.input.so/v1/vectors/<file>` |

Relative links between spec files are rewritten to these URLs (`a2a-extension.md#9-2` → `/v1/#9-2`, `schemas/step.schema.json` → `/v1/schemas/step.schema.json`).

Heading ids: a numbered heading takes its number (`## 9.2 Delivery` → `#9-2`, `### A.1 Examples` → `#a-1`), so links survive a retitle. Other headings take a slug of their text. The protocol page gets a table of contents from its `##` and `###` headings.

## Output

```text
site/dist/                            # uploaded as the bucket's root
├── manifest.json                     # every file with its content type and cache control (not uploaded)
├── index.html                        # protocol
├── sitemap.xml                       # the two spec pages
├── style.<hash>.css                  # content-hashed, cached for a year
└── v1/
    ├── index.html                    # A2A extension
    ├── schemas/index.html            # file list
    ├── schemas/*.json                # verbatim, application/schema+json
    ├── vectors/index.html            # file list
    └── vectors/*.json                # verbatim, application/json
```

Cache control: HTML and the sitemap `public, max-age=300, must-revalidate`; JSON `public, max-age=3600`; the stylesheet `public, max-age=31536000, immutable`.

## Noindex switch

The spec is private until launch, so every page carries `<meta name="robots" content="noindex, nofollow">` unless the build runs with `AGENT_TALK_SITE_NOINDEX=0`. `manifest.json` records which one was built (`"noindex": true`). For launch, rebuild with `AGENT_TALK_SITE_NOINDEX=0`, upload and invalidate. `talk.input.so` serves no `robots.txt`, so nothing disallows crawling.

## Hosting

`talk.input.so` is its own small site, apart from the web app on `input.so` and the marketing site on `www.input.so`:

- A private S3 bucket behind its own CloudFront distribution (origin access control), with an ACM certificate for `talk.input.so` in `us-east-1` and a DNS alias record.
- A viewer-request CloudFront function that serves `index.html` for folder URLs. `/v1` must answer `200` with the page, not a redirect, because `https://talk.input.so/v1` is the A2A extension URI; the canonical tag points search engines to the trailing-slash URL.

    ```js
    function handler(event) {
        var request = event.request;
        var uri = request.uri;
        if (uri.endsWith("/")) {
            request.uri = uri + "index.html";
        } else if (uri.split("/").pop().indexOf(".") === -1) {
            request.uri = uri + "/index.html";
        }
        return request;
    }
    ```

- A 404 for anything else: no fallback page, so a missing schema is a 404 a tool can see.

The pages load one same-origin stylesheet and an inline `application/ld+json` block, and run no scripts.

## Upload

Upload each file with the metadata from the manifest, then remove keys the build no longer produces (old stylesheets, removed schemas):

```sh
BUCKET=<talk.input.so bucket>
DISTRIBUTION_ID=<talk.input.so distribution>

cd site/dist
jq -r '.files[] | [.path, .contentType, .cacheControl] | @tsv' manifest.json |
    while IFS=$'\t' read -r path type cache; do
        aws s3 cp "$path" "s3://$BUCKET/$path" --content-type "$type" --cache-control "$cache"
    done

jq -r '.files[].path' manifest.json | sort > /tmp/agent-talk-local.txt
aws s3api list-objects-v2 --bucket "$BUCKET" --query 'Contents[].Key' --output text |
    tr '\t' '\n' | grep -v '^None$' | sort > /tmp/agent-talk-remote.txt
comm -13 /tmp/agent-talk-local.txt /tmp/agent-talk-remote.txt |
    while read -r key; do aws s3 rm "s3://$BUCKET/$key"; done

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*'
```
