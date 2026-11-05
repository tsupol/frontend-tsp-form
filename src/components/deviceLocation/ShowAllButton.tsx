// "Show all" on a Leaflet map: zooms back out to every point after someone has
// zoomed in on one. Drawn like the map's own +/− controls, which are light in
// both themes because the map tiles are.

import { Maximize } from 'lucide-react';

export function ShowAllButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-action="MAP_SHOW_ALL"
      className="absolute top-2.5 right-2.5 z-[1000] inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-white text-gray-800 border-2 border-black/20 bg-clip-padding hover:bg-gray-100 cursor-pointer"
    >
      <Maximize size={12} />{label}
    </button>
  );
}
