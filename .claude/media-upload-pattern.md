---
name: Media upload pattern
description: How image uploads work — S3 upload flow, imageConfig presets, fn_media_upload RPC, storage_path format, and all usage types
type: reference
---

## Upload Flow

1. **Client resize** — `ImageUploader` from tsp-form resizes via canvas using `ResizeOptions`
2. **Upload to S3** — `POST {config.uploadUrl}/upload/s3` with FormData `{file, key}`, returns `{success, data: {key}}`
3. **Save path to backend** — call RPC with relative path (no scheme/domain)

## Servers

- Upload: `config.uploadUrl` (`https://misc.ecap.cc/api/v1`)
- Storage: `config.s3BaseUrl` (`https://nnf-system-bucket.s3.ap-southeast-1.amazonaws.com`)
- Display URL = `s3BaseUrl + relativePath`

## Existing Implementation

- **uploadToS3()** helper in `src/pages/UserPage.tsx` (lines 26-35) — should be extracted to shared util
- **imageConfig** in `src/config/config.ts` — currently only has `userProfile` preset
- **ImageUploader** component from tsp-form — handles file pick + client resize, returns `UploadedImage[]`

## imageConfig Design

All media presets live in `src/config/config.ts` → `imageConfig`. Each preset defines:
- `sizes` — map of size key → `ResizeOptions` (which variants to generate: `md`, `sm`, `thumb`, etc.)
- `path` — function returning S3 key (relative path)
- `maxFiles` — max count for ALBUM mode
- `usageType` — matches backend `usage_type` enum
- `entityType` — matches backend `entity_type` enum

## Backend: fn_media_upload

```ts
apiClient.rpc('fn_media_upload', {
  p_entity_type: 'ASSET',          // entity table
  p_entity_id: 999,                // entity PK
  p_usage_type: 'PHOTO',           // usage category
  p_storage_path: {                // JSONB — relative paths per size
    original: '/uploads/assets/999/photo-0-original.webp',
    md: '/uploads/assets/999/photo-0-md.webp',
    sm: '/uploads/assets/999/photo-0-sm.webp',
  },
  p_caption: 'optional caption',   // optional
})
```

**Display modes:** SINGLE (replace) vs ALBUM (append + sort_order)
- SINGLE: ID_CARD, SIGNATURE, SLIP, PROFILE
- ALBUM: everything else

## Backend: v_entity_media (read)

```
GET /v_entity_media?entity_type=eq.ASSET&entity_id=eq.999&usage_type=eq.PHOTO&is_active=eq.true&order=sort_order
```

Returns `storage_path` JSONB — UI picks size: `thumb` for list, `md` for detail, `original` for fullscreen.

## All Usage Types (inventory-relevant)

| entity_type | usage_type | Mode | Lock trigger | Max |
|---|---|---|---|---|
| ASSET | PHOTO | ALBUM | DP approve | - |
| REPAIR_ORDER | BEFORE_REPAIR | ALBUM | - | - |
| REPAIR_ORDER | AFTER_REPAIR | ALBUM | - | - |
| PO_LINE | BUYBACK_CONDITION | ALBUM | buyback approve | 5 |
| PRODUCT_MODEL | CATALOG | ALBUM | - | - |
| CUSTOMER | ID_CARD | SINGLE | - | 1 |
| CONTRACT | SIGNATURE | SINGLE | - | 1 |
| CONTRACT | EVIDENCE | ALBUM | - | - |
| CONTRACT | PAYMENT_SLIP | ALBUM | day_close | - |
| CONTRACT | DOCUMENT | ALBUM | - | - |
| PAYMENT_SUBMISSION | SLIP | SINGLE | approve | 1 |

## Other Media RPCs

- `fn_media_remove({p_entity_media_id})` — delete (fails if locked: `CORE.STATE.MEDIA_LOCKED`)
- `fn_media_reorder({p_entity_type, p_entity_id, p_usage_type, p_media_ids: [3,1,2]})` — ALBUM sort
- `fn_media_set_caption({p_entity_media_id, p_caption})` — update caption

## storage_path Keys

Backend allows: `original`, `lg`, `md`, `sm`, `thumb` (same as user profile).
Currently user profile only stores `sm`. Inventory media should store `md` + `sm` (+ `original` for documents/evidence).
