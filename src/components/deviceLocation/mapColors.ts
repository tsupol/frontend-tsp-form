// Colours shared by the maps and the lists beside them, kept apart from the map
// components so a list can use them without pulling Leaflet into the page.

// Group 1 has the most fixes. Fixes outside every group are grey.
const CLUSTER_COLORS = ['#2563eb', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777'];
const NO_CLUSTER_COLOR = '#6b7280';

export function clusterColor(clusterNo: number | null): string {
  return clusterNo == null ? NO_CLUSTER_COLOR : CLUSTER_COLORS[(clusterNo - 1) % CLUSTER_COLORS.length];
}

// Customer map pins, by how late the contract is (BE suggestion, mig 434).
export const OVERDUE_COLORS = { none: '#16a34a', some: '#ca8a04', late: '#dc2626' } as const;

export function overdueColor(overdueDays: number): string {
  return overdueDays <= 0 ? OVERDUE_COLORS.none : overdueDays < 7 ? OVERDUE_COLORS.some : OVERDUE_COLORS.late;
}

// A fix older than this is drawn faded on the customer map.
export const STALE_FIX_DAYS = 7;

// In collection, waiting for the device to be taken back or for legal action.
export function isRepoOrLegal(dunningStatus: string | null): boolean {
  return dunningStatus === 'WAIT_FOR_REPO' || dunningStatus === 'WAIT_FOR_LEGAL';
}
