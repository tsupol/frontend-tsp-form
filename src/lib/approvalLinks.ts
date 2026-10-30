// Address of one request on the approvals page: /admin/approvals/<type>/<id>.
// `id` is the approval row's own id, which the backend sets to the source
// record's id — po_id for PO and BUYBACK, request_id for ASSET_SELL_OUT
// (checked on DEV 2026-10-30) — so a notification can link straight to it.
export function approvalPath(type: string, id: number | string): string {
  return `/admin/approvals/${type.toLowerCase()}/${id}`;
}
