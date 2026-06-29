# be-media — file upload + contract-PDF service

Go microservice at `D:\dev\nnf\be-media` (lives **inside** the nnf repo). Replaces the old `nnf-misc-go`, which is superseded — don't read, run, or deploy misc-go.

## Storage — Cloudflare R2, two buckets

| Bucket | Access | How the FE gets a URL |
|---|---|---|
| `nnf-public` | public | Plain `<img src>` works. Base = `R2_PUBLIC_URL` = `https://pub-ec97c2bdb4564779b166762d78a98593.r2.dev` |
| `nnf-private` | no public access | Must call `GET /media/url` for a ~4 h presigned URL |

**Privacy is inferred from the key prefix**, not a flag: `uploads/` → public, `private/` → private.

## Routes (`/api/v1`)

| Route | Purpose |
|---|---|
| `GET /upload/spec?type={type}` | Resize/processing contract for an upload type |
| `POST /upload` | Upload one file at one size. Deterministic keys — **re-upload overwrites** |
| `GET /media/url?key=...` | Resolve a key → URL (presigned for private) |
| `DELETE /media` | Batch delete. Body: `{keys: [key1, key2]}` |

Upload-type registry + `R2_DIRECT_TYPES` live in `be-media/internal/`.

## Deploy

`just deploy` from `D:\dev\nnf\be-media` (NOT misc-go's old `direct-deploy`). Every change under `be-media/` MUST add a `be-media/CHANGELOG.md` entry **in the same commit**. Don't stop at a local build.

## R2 access via AWS CLI

Endpoint `https://b4317a366d1f46b8a5c6a864c7447fbc.r2.cloudflarestorage.com`, `--region auto`. Credentials in `D:\dev\nnf\be-media\.env` (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`). The token is bucket-scoped, so `aws s3 ls` at root (no bucket) returns AccessDenied — expected. List inside a bucket:

```bash
aws s3 ls s3://nnf-private/private/ --endpoint-url https://b4317a366d1f46b8a5c6a864c7447fbc.r2.cloudflarestorage.com --region auto
```

## FE consumption note

View `*_url` columns are storage **keys**, not URLs — pipe through the media-URL resolver (private keys need the presigned `/media/url` round-trip). See `.claude/media-upload-pattern.md` for the upload + attach flow.
