// The customer map's Leaflet canvas (UI_SUMMARY 159 §5, mig 434): one pin per
// contract at its phone's newest fix. Loaded only on the customer map page.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ShowAllButton } from './ShowAllButton';

export interface CustomerPin {
  /** contract id */
  id: number;
  lat: number;
  lon: number;
  color: string;
  /** The fix is old: drawn faded. */
  faded: boolean;
  /** Waiting for repossession or legal action: drawn with a black outline. */
  flagged: boolean;
  /** The backend's verdict says the customer lives here: a house inside the pin. */
  resident: boolean;
  /** Shown on hover. */
  label: string;
}

const FIT_OPTIONS: L.FitBoundsOptions = { padding: [40, 40], maxZoom: 15 };

const DOT ='<circle cx="14" cy="14" r="5" fill="#ffffff"/>';
const HOUSE = '<path d="M8.5 14.5l5.5-4.8 5.5 4.8M10.2 13.3V19h2.8v-3h2v3h2.8v-5.7" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';

function pinIcon(p: CustomerPin, selected: boolean): L.DivIcon {
  const scale = selected ? 1.3 : 1;
  const w = Math.round(28 * scale);
  const h = Math.round(36 * scale);
  const stroke = p.flagged ? '#111827' : '#ffffff';
  const strokeW = p.flagged ? 3 : 1.5;
  return L.divIcon({
    className: '',
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    tooltipAnchor: [0, -h],
    html: `<svg width="${w}" height="${h}" viewBox="-2 -2 32 40" xmlns="http://www.w3.org/2000/svg" style="opacity:${p.faded && !selected ? 0.45 : 1}"><path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 36 14 36s14-11.7 14-22.1C28 6.2 21.7 0 14 0z" fill="${p.color}" stroke="${stroke}" stroke-width="${strokeW}"/>${p.resident ? HOUSE : DOT}</svg>`,
  });
}

export default function CustomerMapCanvas({ pins, selectedId, focusTick = 0, onPinClick, showAllLabel, className = '' }: {
  pins: CustomerPin[];
  selectedId: number | null;
  /** Bumped when a row asks to bring its pin into view. */
  focusTick?: number;
  onPinClick: (id: number) => void;
  showAllLabel: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<number, L.Marker>());
  const onClickRef = useRef(onPinClick);
  onClickRef.current = onPinClick;
  const fitRef = useRef<{ bounds: L.LatLngBounds; at: number } | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const map = L.map(hostRef.current, { zoomControl: true });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Thailand, until the pins arrive.
    map.setView([13.75, 100.5], 6);
    // A fit made just before the panel settled is made again, or the pins end
    // up at an edge (or off the map).
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      const fit = fitRef.current;
      if (fit && Date.now() - fit.at < 1500) map.fitBounds(fit.bounds, FIT_OPTIONS);
    });
    observer.observe(hostRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Redraw the pins; the view fits them whenever the set changes (load, filter).
  const pinKey = pins.map((p) => p.id).join(',');
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markers.current.clear();
    for (const p of pins) {
      const m = L.marker([p.lat, p.lon], { icon: pinIcon(p, p.id === selectedId), keyboard: false, zIndexOffset: p.flagged ? 500 : 0 })
        .bindTooltip(p.label, { direction: 'top' })
        .on('click', () => onClickRef.current(p.id))
        .addTo(layer);
      markers.current.set(p.id, m);
    }
    showAll(true);
  }, [pinKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function showAll(justDrawn = false) {
    const map = mapRef.current;
    if (!map || pins.length === 0) return;
    if (pins.length === 1) { map.setView([pins[0].lat, pins[0].lon], 15); return; }
    const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lon] as L.LatLngTuple));
    map.fitBounds(bounds, FIT_OPTIONS);
    if (justDrawn) fitRef.current = { bounds, at: Date.now() };
  }

  // The chosen pin is drawn larger and on top.
  const lastSelected = useRef<number | null>(null);
  useEffect(() => {
    for (const id of [lastSelected.current, selectedId]) {
      if (id == null) continue;
      const m = markers.current.get(id);
      const p = pins.find((x) => x.id === id);
      if (m && p) {
        m.setIcon(pinIcon(p, id === selectedId));
        m.setZIndexOffset(id === selectedId ? 2000 : p.flagged ? 500 : 0);
      }
    }
    lastSelected.current = selectedId;
  }, [selectedId, pinKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focusTick === 0 || selectedId == null) return;
    const p = pins.find((x) => x.id === selectedId);
    if (p) mapRef.current?.setView([p.lat, p.lon], Math.max(mapRef.current.getZoom(), 15));
  }, [focusTick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative isolate z-0 ${className}`}>
      <div ref={hostRef} className="h-full w-full" />
      {pins.length > 1 && <ShowAllButton label={showAllLabel} onClick={() => showAll()} />}
    </div>
  );
}
