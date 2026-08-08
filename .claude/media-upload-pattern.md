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

### Picking the upload UI

> ### ⛔ NEVER hand-roll a drop zone
>
> If you are typing `onDrop` / `onDragOver` / `dataTransfer` / a `dragDepth`
> counter in a page or modal, stop — you are rebuilding a component that
> exists. A custom zone shipped here once that was **drop-only and could not be
> clicked**, because the hand-rolled version forgot the click path.

| Need | Use |
|---|---|
| **Several images** (strip of thumbs, max N) | `<MultiImageUploader>` — `src/components/MultiImageUploader.tsx` |
| **One image** (slip, signature, ID card) | `<SingleImageUploader>` — `src/components/SingleImageUploader.tsx` |
| Neither fits | `<ImageUploader>` from `tsp-form` directly — but say why in a comment |

Both project components share the same dashed zone so an upload field looks the
same wherever it appears, and both open the zoomable viewer on click.

#### MultiImageUploader (the multi-image pattern)

Owns everything the four hand-rolled copies used to each re-derive: click +
drag + paste intake, HEIC conversion, non-image rejection, the max-N cap, the
80px tile grid, remove buttons, and a zoomable viewer.

```tsx
<MultiImageUploader
  items={files.map((file, i) => ({ kind: 'staged', id: String(i), file }))}
  onAdd={(files) => setFiles(prev => [...prev, ...files].slice(0, MAX))}
  onRemove={(item) => setFiles(prev => prev.filter((_, i) => String(i) !== item.id))}
  max={MAX}
  disabled={busy}
  onError={setError}
/>
```

- **Two item kinds, one grid.** `staged` = a local `File` not yet uploaded;
  removing costs nothing so the component drops it immediately. `persisted` =
  already on the server; the component only *reports* the intent via
  `onRemove` so the caller can run its confirm dialog + delete RPC. Set
  `locked: true` on a persisted item to hide its trash button entirely.
- **Tile size is measured, not hardcoded.** A `ResizeObserver` picks the column
  count: how many 80px tiles fit, then one more if it still clears a 64px
  floor. A fixed 80px stranded ~44px on a 375px phone — 3 tiles where 4 fit.
  Don't replace this with a plain `auto-fill` grid; CSS alone can shrink-to-fit
  **or** cap at 80px, not both (a roomy container silently rendered 65px tiles).
- **Zone geometry**: dashed border, `min-height` = one tile + padding (104px),
  so it doesn't jump between empty and filled.
- `onError(message)` hands back an already-translated string (non-image
  rejected, over max, HEIC decode failed) — render it in `<ModalErrorBand>`.

#### SingleImageUploader (the one-image pattern)

Empty → the same dashed drop zone (click + drag). Filled → the image, zoomable
on click, with a Remove button. `ContractActions.tsx` (payment slip) is the
reference.

```tsx
<SingleImageUploader
  previewUrl={slipKey ? slipPreviewUrl : null}   // null → empty zone
  onUpload={handleSlipUpload}                    // caller uploads, sets previewUrl
  onRemove={handleSlipClear}                     // caller deletes the orphan
  resizeOptions={slipSpec.resize}
  sizes={slipSpec.sizes}
  disabled={uploading || mutation.isPending}
  busy={uploading}
  placeholder={<><Receipt size={20} /><span className="text-xs">…</span></>}
/>
```

**UI-only by design.** Uploading, R2 keys, and orphan cleanup stay with the
caller — those differ per upload type (contract slip vs signature vs ID card),
and the caller already owns delete-on-cancel. The component only turns "an
image arrived" into `onUpload`.

Underneath it is tsp-form's `ImageUploader`, whose props pass through:

- `sizes` (multi-size): emits `UploadedImage.variants[label]`. Top-level `file` is undefined in this mode.
- `resizeOptions` (single-size): emits top-level `UploadedImage.file`.
- `onUpload(images: UploadedImage[])`. `originalFile` is the untouched source.
- ⚠️ `ImageUploader` takes **no `style` prop** — it is silently dropped. Style it
  with `className` utilities.

### Viewing images — always navigable

**Never wire a thumbnail strip to a single-image lightbox.** If the user can see
N thumbnails, the viewer must page through all N — opening photo 2 and being
unable to reach photo 3 is the bug this replaced.

`src/components/MediaLightbox.tsx` exports three, all wrapping tsp-form's
`ImageZoomPan` (pinch/wheel zoom, pan, rubber-band) in the same dark chrome:

| Component | Takes | Use for |
|---|---|---|
| `MediaLightboxGallery` | `urls: string[]` | staged local files (`blob:` URLs) — what `MultiImageUploader` uses internally |
| `MediaLightboxKeyGallery` | `mediaKeys: string[]` | stored media; presigns the **current** key via `useMediaUrl`, so callers holding keys don't presign by hand |
| `MediaLightbox` | one `mediaKey` | genuinely single-image callers only (bank slip, chat image) |

Both galleries wrap around, bind ← →, show `n / total`, hide the arrows for a
single image, and remount the viewer per image so zoom/pan resets.

Callers own the index, not the key:

```tsx
const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
// …thumb onClick={() => setLightboxIndex(i)}
<MediaLightboxKeyGallery
  open={lightboxIndex !== null}
  onClose={() => setLightboxIndex(null)}
  mediaKeys={photoStrip.map(p => p.full)}
  index={lightboxIndex ?? 0}
  onIndexChange={setLightboxIndex}
/>
```

⚠️ **Build the thumbnails and the key list from ONE filtered array.** If the
strip skips entries with a missing key but the viewer doesn't (or vice versa),
the index addresses a different photo than the one clicked.
`ExpenseDetailPanel.tsx` (`photoStrip`) is the reference.

**Still on the single-image lightbox** (each loses navigation once open, migrate
on touch): repair condition photos, buyback wizard photos, contract attachments
(two strips).

### HEIC input

`isHeicFile` / `isImageFile` / `convertHeicToJpeg` live in `src/lib/beMedia.ts`.
**Both project uploaders handle HEIC for you** — you only call these directly
when building something neither covers.

`convertHeicToJpeg` tries two decoders in order:

1. **Native canvas** — Safari/iOS decodes HEIC itself. Free, no download, and
   it is where these files actually originate.
2. **`heic2any` (WASM)** — everywhere else. `import()`ed dynamically so it
   builds as its own ~1.35 MB chunk (`assets/heic2any-*.js`) and is fetched
   **only when a `.heic` is actually dropped**. Never import it statically.

If both fail the caller gets `imageUploader.heicFailed` via `onError`.

⚠️ **tsp-form's `ImageUploader` cannot be handed a HEIC.** It calls
`loadImageFromFile` up-front and skips any file whose type isn't `image/*` —
and many HEICs report an empty type, so they vanish with no error.
`SingleImageUploader` therefore intercepts the drop/pick in a capture-phase
handler, converts, then feeds the JPEG back into the library's own `<input>`
via a `DataTransfer` so its resize pipeline is unchanged. Don't "simplify" this
by converting inside `onUpload` — by then the file is already gone.

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
