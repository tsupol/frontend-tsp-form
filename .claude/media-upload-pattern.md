# Media Upload Pattern

## Upload Flow

1. **Client resize** — `ImageUploader` from tsp-form resizes via canvas using `resizeOptions`
2. **Upload to S3** — `uploadToS3(file, key)` in `src/lib/upload.ts`
3. **Register in DB** — call `fn_media_attach` RPC with relative path + metadata

## Servers

| Role | Config key | Default |
|---|---|---|
| Upload proxy | `config.uploadUrl` | `https://misc.ecap.cc/api/v1` |
| S3 bucket | `config.s3BaseUrl` | `https://nnf-system-bucket.s3.ap-southeast-1.amazonaws.com` |

Display URL = `config.s3BaseUrl + "/" + relativePath`

## tsp-form ImageUploader

The component handles file pick + client-side resize. Key points:

- `resizeOptions` prop controls output size (uses `ResizeOptions` type)
- `onUpload` callback receives `UploadedImage[]`
- `UploadedImage.file` = resized file, `UploadedImage.originalFile` = untouched original
- **One resize output per upload** — the component does NOT produce multiple sizes

### Built-in RESIZE_PRESETS

| Preset | maxWidth | maxHeight | quality |
|---|---|---|---|
| `thumbnail` | 150 | 150 | 0.8 |
| `small` | 320 | 320 | 0.8 |
| `medium` | 640 | 640 | 0.85 |
| `large` | 1280 | 1280 | 0.85 |
| `fullHD` | 1920 | 1080 | 0.9 |
| `4k` | 3840 | 2160 | 0.9 |
| `original` | Infinity | Infinity | 1.0 |

Default (no `resizeOptions`): 1920x1080, quality 0.85, format 'original', mode 'contain'.

### ResizeOptions

```ts
{
  maxWidth?: number;        // Scale down to fit (with contain/cover)
  maxHeight?: number;
  width?: number;           // Exact size (overrides maxWidth/maxHeight)
  height?: number;
  aspectRatio?: number;     // e.g. 1 for square, 16/9
  mode?: 'contain' | 'cover' | 'fill';
  cropPosition?: 'center' | 'top' | 'bottom' | 'left' | 'right' | ...;
  quality?: number;         // 0-1 for JPEG/WebP
  format?: 'jpeg' | 'png' | 'webp' | 'original';
}
```

### Common ASPECT_RATIOS

`square: 1`, `4:3`, `3:2`, `16:9`, `21:9`, `3:4`, `2:3`, `9:16`

## Sizing Strategy

**Each upload type uses ONE size only.** No dual sm/lg uploads.

| Type | Size | Resize | Mode | Why |
|---|---|---|---|---|
| User avatar | 320x320 | small | cover, 1:1 | Tiny circle display |
| All other media | 1280x1280 | large | contain | Must be readable/detailed |

Upload `img.file` (the resized output) — never need `img.originalFile` for a second upload.

## Storage Paths (Deterministic, ID-based)

Paths use entity ID so re-uploads overwrite the same S3 key. No timestamps, no orphans.

```
uploads/users/{userId}/profile.webp                      ← avatar (320px)
uploads/customers/{customerId}/id-card.webp              ← 1280px
uploads/contracts/{contractId}/signature.webp            ← 1280px, single
uploads/contracts/{contractId}/evidence-{idx}.webp       ← 1280px, gallery (max 10)
uploads/contracts/{contractId}/slip-{idx}.webp           ← 1280px, gallery (max 5)
uploads/assets/{assetId}/photo-{idx}.webp                ← 1280px, gallery
uploads/repairs/{repairId}/before-{idx}.webp             ← 1280px, gallery
uploads/repairs/{repairId}/after-{idx}.webp              ← 1280px, gallery
uploads/buyback/{poLineId}/condition-{idx}.webp          ← 1280px, gallery (max 5)
```

For gallery items, `{idx}` = sort_order position (0-based).

## Backend RPCs (core.media registry)

Backend source: `D:\dev\nnf\database\DB_PART_001_AUTH_CORE\24_core_media_registry.sql`
UI guide: `D:\dev\nnf\database\DB_PART_001_AUTH_CORE\MEDIA_REGISTRY_UI_GUIDE.md`

### fn_media_attach — upload + link

```ts
await apiClient.rpc('fn_media_attach', {
  p_holding_id:        number,      // from JWT/auth
  p_storage_path:      string,      // relative path with leading slash: '/uploads/assets/123/photo-0.webp'
  p_variants_json:     null,        // null for single-size (no variants needed)
  p_media_type:        'IMAGE',     // IMAGE | DOCUMENT | VIDEO
  p_access_level:      'PUBLIC',    // PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
  p_mime_type:         'image/webp',
  p_file_size_bytes:   number,
  p_original_filename: string | null,
  p_entity_type:       'ASSET',     // ASSET | PO_LINE | CONTRACT | REPAIR_ORDER | etc.
  p_entity_id:         number,
  p_usage_type:        'PHOTO',     // PHOTO | SIGNATURE | ID_SCAN | EVIDENCE | etc.
  p_sort_order:        0,
})
// Returns: { media_id, entity_media_id, access_level, paths: { original: '...' } }
```

### fn_media_detach — soft-unlink

```ts
await apiClient.rpc('fn_media_detach', { p_entity_media_id: number })
```

### fn_media_reorder — batch sort_order (drag-drop)

```ts
await apiClient.rpc('fn_media_reorder', {
  p_entity_type: 'ASSET',
  p_entity_id:   assetId,
  p_usage_type:  'PHOTO',
  p_order:       [{ entity_media_id: N, sort_order: N }, ...],
})
```

### fn_media_replace — swap file in place

```ts
await apiClient.rpc('fn_media_replace', {
  p_entity_media_id:   number,
  p_storage_path:      string,
  p_variants_json:     null,
  p_media_type:        'IMAGE',
  p_mime_type:         string | null,
  p_file_size_bytes:   number | null,
  p_original_filename: string | null,
})
```

## Access Levels

| Level | Who can view | Example |
|---|---|---|
| PUBLIC | Anyone (no auth) | Asset photos, product catalog |
| INTERNAL | Authenticated users in holding | Repair photos, buyback condition |
| CONFIDENTIAL | company_admin + managers | Contract docs, receipts |
| RESTRICTED | Entity parties only | Signatures, ID card scans |

## Entity & Usage Type Registry

| entity_type | usage_type | Access default | Mode | Max |
|---|---|---|---|---|
| ASSET | PHOTO | PUBLIC | gallery | - |
| REPAIR_ORDER | CONDITION_PHOTO | INTERNAL | gallery | - |
| REPAIR_ORDER | REPAIR_PHOTO | INTERNAL | gallery | - |
| TRANSFER_LINE | DAMAGE_EVIDENCE | INTERNAL | gallery | - |
| ASSET | SCRAP_EVIDENCE | CONFIDENTIAL | gallery | - |
| PO_LINE | BUYBACK_PHOTO | INTERNAL | gallery | 5 |
| CONTRACT | CONTRACT_DOC | CONFIDENTIAL | gallery | - |
| CONTRACT | SIGNATURE | RESTRICTED | single | 1 |
| CONTRACT | ID_SCAN | RESTRICTED | single | 1 |
| CONTRACT | EVIDENCE | CONFIDENTIAL | gallery | 10 |
| CONTRACT | PAYMENT_SLIP | CONFIDENTIAL | gallery | 5 |
| SALE_BILL | SIGNATURE | RESTRICTED | single | 1 |
| SALE_BILL | SALE_DOC | CONFIDENTIAL | gallery | - |

**Note:** User profile avatar is OUT OF SCOPE of core.media registry — it uses `me_profile_image_set` / `me_profile_get` in the `user_profile` schema separately.

## Known Issues (Current Codebase)

1. **Wrong RPC name** — frontend calls `fn_media_upload`, backend has `fn_media_attach`
2. **Duplicate uploadToS3** — `UserPage.tsx` has its own copy instead of importing `src/lib/upload.ts`
3. **Dual sm/lg uploads** — wizard sections upload both `img.file` (sm) and `img.originalFile` (lg), should be single upload
4. **Timestamp paths** — wizard uses `Date.now()` in paths, should use deterministic ID-based paths
5. **imageConfig mismatch** — config defines `customerIdCard` path under customer ID, but code uploads under contract ID
