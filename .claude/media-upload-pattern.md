# Media Upload Pattern

Every image upload is a three-stage pipeline. Stages 2 and 3 are shared; stage 1
(resize/encode) is now a single shared function too — do not hand-roll a fourth.

1. **Resize + encode** → `resizeToVariants` from `tsp-form` (one function, configurable).
2. **Transport** → `beMediaUpload` / `beMediaUploadFromImage` in `src/lib/beMedia.ts` (authenticated POST to be-media).
3. **Register in DB** → `fn_media_attach` RPC with the storage key + metadata.

## Servers (be-media + R2, NOT misc-go/S3)

Uploads go through the **be-media broker** (`https://be-media.czynet.dev/api/v1`,
override `VITE_BE_MEDIA_URL`), which forwards the user's JWT and writes to
**Cloudflare R2**. The old misc-go-direct + AWS-S3 path is gone.

| Bucket | Key prefix | Read path |
|---|---|---|
| `nnf-public` | `uploads/` | `publicMediaUrl(key)` → `config.r2PublicUrl + "/" + key` (plain `<img src>`) |
| `nnf-private` | `private/` | `privateMediaUrl(key)` → be-media `/media/url` presign (1 h, cached 45 min) |

Privacy is inferred from the key prefix — see `getMediaPrivacy` in `src/lib/mediaPath.ts`.
Always resolve display URLs through `useMediaUrl(normalizeKey(key))`; never build a private URL by hand.

## Stage 1 — `resizeToVariants` (tsp-form)

The image resize/encode processor was extracted out of the `ImageUploader`
component into a standalone export so non-drop-zone flows (camera capture, chat
attachments, post-crop output, programmatic re-uploads) share it.

```ts
import { resizeToVariants } from 'tsp-form';

const variants = await resizeToVariants(
  src,        // File (decoded internally) OR HTMLImageElement (e.g. post-crop — saves a decode)
  {           // label → ResizeOptions; one entry per size
    sm: { maxWidth: 320,  maxHeight: 320,  quality: 0.82, format: 'webp', mode: 'contain' },
    lg: { maxWidth: 1280, maxHeight: 1280, quality: 0.82, format: 'webp', mode: 'contain' },
  },
  baseName,   // optional; output files named `${baseName}-${label}.${ext}`
);
// → Record<string, ResizedVariant>  where ResizedVariant = { file, preview, width, height, size }
```

- **Honest mime.** `format: 'webp'` falls back to JPEG on browsers that can't encode webp (Safari < 17.4) and reports the type the bytes **actually are** — `variant.file.type` and the file extension are never a lie. `format: 'png'` is a real lossless branch (use for line art / signatures); `'original'` keeps PNG/JPEG sources else webp.
- **`ImageUploader` (the UI component) uses this internally.** Use the component for drag-drop zones; call `resizeToVariants` directly for everything else.
- **Do NOT re-implement canvas resize.** There is no longer an `encodeCanvas`/`renameForExt` in `src/lib/upload.ts` — they were deleted once every path routed through `resizeToVariants`.

### ImageUploader (drag-drop UI)

> ### ⛔ NEVER hand-roll a drop zone
>
> `ImageUploader` from `tsp-form` **already does click + drag-and-drop in one
> element**, including the drag highlight (`.image-uploader-dragging`). If you
> find yourself writing `onDrop` / `onDragOver` / `dataTransfer` / a
> `dragDepth` counter, stop — you are rebuilding this component. There is no
> `onDrop` handler anywhere in `src/`, and that is deliberate.
>
> This has been reinvented before: a custom drop zone shipped in the branch
> expense modal that was **drop-only and could not be clicked**, because the
> hand-rolled version forgot the click path the component gives free.
>
> **Multi-image is supported** — `multiple` + `maxFiles={n}`. Don't conclude
> "there's no multi-image pattern" from the fact that most callers upload one
> photo per modal (repair / sell-out / buyback all do). Set the two props.

- `sizes` prop (multi-size): emits `UploadedImage.variants[label]`. Top-level `file` is undefined in this mode.
- `resizeOptions` prop (single-size): emits top-level `UploadedImage.file`.
- `onUpload(images: UploadedImage[])`. `originalFile` is the untouched source.
- `placeholder` prop replaces the default "Click or drag image" body — use it to
  restyle the zone rather than building your own container around a hidden input.
- Staging several files before an id exists (the entry/row must be created first):
  keep your own thumbnail strip + `File[]` state, feed it from
  `onUpload(imgs => imgs.map(i => i.originalFile))`, and render `<ImageUploader>`
  underneath. `CreateExpenseModal.tsx` is the reference for this shape.

### HEIC input

`isHeicFile` / `isImageFile` / `convertHeicToJpeg` live in `src/lib/beMedia.ts`.
Conversion is canvas-based and works only where the browser decodes HEIC
natively (**Safari/iOS** — where these files originate). Chrome/Firefox reject
the decode and the caller shows a "convert to JPEG first" message. Covering
desktop Chrome needs a WASM decoder (`heic2any` / `libheif-js`, ~1.5 MB) — not
installed; ask before adding it.

## Stage 2 — transport (`src/lib/beMedia.ts`)

```ts
// One file, one size:
const r = await beMediaUpload({ type, file, size, params });   // → { key, bucket, privacy, content_type, ... }

// Every variant of an UploadedImage (reads image.variants[label].file,
// falls back to top-level image.file for single-variant images):
const results = await beMediaUploadFromImage({ type, image, params });  // → Record<size, result>
```

- `type` selects the resize/path contract from the hardcoded `UPLOAD_SPECS` registry in `beMedia.ts` (be-media has no `/upload/spec` endpoint — the registry mirrors misc-go's `pkg/uploadspec/spec.go`).
- `params` fills the spec's `path_params` (e.g. `{ contract_id, customer_id }`), producing a **deterministic** R2 key — re-upload overwrites.
- The returned `content_type` is authoritative for `p_mime_type`. `mimeFromKey(key)` (reads the extension) is the fallback when you only have a key.

### Upload-spec registry (`UPLOAD_SPECS`)

| type | privacy | sizes | path_params |
|---|---|---|---|
| `chat_image` | private | sm 320, lg 1800 | contract_id |
| `contract_payment_slip` | private | lg 1800 | contract_id |
| `contract_signature` | private | sm 320 | contract_id, customer_id |
| `branch_signatory_signature` | private | sm 320 | branch_id, signatory_slug |
| `contract_evidence` | private | sm 320, md 1280 | contract_id |
| `customer_id_card` | private | lg 1800 | customer_id |
| `buyback_condition` | **public** | sm 320, md 1280 | po_line_id |
| `branch_expense_slip` | private | thumb 240, lg 1200 | expense_id |
| `user_profile` | public | sm 320 (cover 1:1) | user_id |

Multi-size types: pass `p_variants_json: { sm: toStoragePath(...), lg: ... }`. Single-size **private** types: pass `p_variants_json: null` (the `chk_media_variants_keys` constraint requires variant values to be PUBLIC paths regardless of access level).

## Stage 3 — `fn_media_attach`

Backend source: `D:\dev\nnf\database\DB_PART_001_AUTH_CORE\24_core_media_registry.sql`
UI guide: `D:\dev\nnf\database\DB_PART_001_AUTH_CORE\MEDIA_REGISTRY_UI_GUIDE.md`

```ts
await apiClient.rpc('fn_media_attach', {
  p_holding_id:        user.holding_id,
  p_storage_path:      toStoragePath(result.key),   // private → "private/...", public → "/uploads/..."
  p_variants_json:     null,                          // or { sm, lg } of PUBLIC paths (see above)
  p_media_type:        'IMAGE',                        // IMAGE | DOCUMENT | VIDEO
  p_access_level:      'CONFIDENTIAL',                 // PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
  p_mime_type:         result.content_type,            // from be-media; never hardcode
  p_file_size_bytes:   file.size,
  p_original_filename: file.name | null,
  p_entity_type:       'CONTRACT',
  p_entity_id:         entityId,
  p_usage_type:        'SIGNATURE',
  p_sort_order:        0,
  p_caption:           null,
})
// → { media_id, entity_media_id, access_level, paths: { original: '...' } }
```

`toStoragePath` (in `mediaPath.ts`) applies the leading slash only where the
backend's `core.is_media_path_*` validators expect it: `/uploads/...` for public,
`private/...` for private. Never hand-roll `/${key}`.

### Other media RPCs

- `fn_media_detach({ p_entity_media_id })` — soft-unlink.
- `fn_media_reorder({ p_entity_type, p_entity_id, p_usage_type, p_order: [{entity_media_id, sort_order}] })` — drag-drop reorder.
- `fn_media_replace({ p_entity_media_id, p_storage_path, p_variants_json, p_media_type, p_mime_type, p_file_size_bytes, p_original_filename })` — swap file in place.

## Access Levels

| Level | Who can view | Example |
|---|---|---|
| PUBLIC | Anyone (no auth) | Asset photos, buyback condition, avatars |
| INTERNAL | Authenticated users in holding | Repair photos |
| CONFIDENTIAL | company_admin + managers | Contract docs, payment slips, evidence |
| RESTRICTED | Entity parties only | Signatures, ID card scans |

## Entity & Usage Type Registry

| entity_type | usage_type | Access | Mode | Max |
|---|---|---|---|---|
| ASSET | PHOTO | PUBLIC | gallery | - |
| REPAIR_ORDER | CONDITION_PHOTO / REPAIR_PHOTO | INTERNAL | gallery | - |
| TRANSFER_LINE | DAMAGE_EVIDENCE | INTERNAL | gallery | - |
| ASSET | SCRAP_EVIDENCE | CONFIDENTIAL | gallery | - |
| PO_LINE | BUYBACK_PHOTO | PUBLIC | gallery | 5 |
| CONTRACT | CONTRACT_DOC | CONFIDENTIAL | gallery | - |
| CONTRACT | SIGNATURE | RESTRICTED | single | 1 |
| CONTRACT | ID_SCAN | RESTRICTED | single | 1 |
| CONTRACT | EVIDENCE | CONFIDENTIAL | gallery | 10 |
| CONTRACT | PAYMENT_SLIP | CONFIDENTIAL | gallery | 5 |
| SALE_BILL | SIGNATURE | RESTRICTED | single | 1 |
| SALE_BILL | SALE_DOC | CONFIDENTIAL | gallery | - |

**Note:** User profile avatar uses `me_profile_image_set` / `me_profile_get` in the `user_profile` schema, separate from the core.media registry.

## Gotchas

- **Single-variant images must still upload.** `SignatureCapture` and crop/camera flows that produce one variant: `resizeToVariants` returns a `variants` map, and `beMediaUploadFromImage` falls back to the top-level `file` when a size is absent. The historical bug — a single-variant `UploadedImage` (top-level `file`, no `variants`) fed to `beMediaUploadFromImage`, which only read `variants[size].file`, uploading nothing and throwing "Upload returned no result" before any network call — is now structurally prevented because every stage-1 path emits a `variants` map.
- **Mime follows the bytes.** Draw-mode signatures are PNG, photo captures are webp — never hardcode `image/webp` in `fn_media_attach`. Use `result.content_type` (preferred) or `mimeFromKey(key)`.
- **Deterministic keys overwrite.** be-media keys are derived from `type` + `path_params`; sending the same params re-uploads the same object. For galleries pass a unique `idx` (e.g. `Date.now()` per send, NOT a count of existing items — concurrent sends collide on an identical count).
