// The map in the location window (UI_SUMMARY 159 §1 ④, mig 434): every fix of
// the device as a dot, the backend's groups of fixes as rings, a pin with its
// accuracy ring on the fix that is chosen, and a house for the verdict "this is
// where they live". Leaflet + OSM tiles, loaded only when a location window opens.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { clusterColor } from './mapColors';

export interface MapPoint {
  lat: number;
  lon: number;
  /** Accuracy ring for a fix, spread for the home point. */
  radiusM?: number | null;
}

export interface MapFix {
  id: number;
  lat: number;
  lon: number;
  clusterNo: number | null;
  /** Shown on hover. */
  label: string;
}

export interface MapCluster {
  clusterNo: number;
  lat: number;
  lon: number;
  radiusM: number;
  label: string;
}

/** A request to bring a place into view; `tick` changes on every request. */
export interface MapFocus {
  tick: number;
  lat: number;
  lon: number;
  radiusM?: number | null;
}

const ZOOM = 16;
// Rings smaller than this are hard to see or hover on a city-scale view.
const MIN_RING_M = 25;

const pinIcon = L.divIcon({
  className: '',
  iconSize: [28, 36],
  iconAnchor: [14, 36],
  html: '<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 36 14 36s14-11.7 14-22.1C28 6.2 21.7 0 14 0z" fill="#dc2626" stroke="#ffffff" stroke-width="1.5"/><circle cx="14" cy="14" r="5" fill="#ffffff"/></svg>',
});

const homeIcon = L.divIcon({
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  html: '<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><circle cx="15" cy="15" r="14" fill="#16a34a" stroke="#ffffff" stroke-width="1.5"/><path d="M8 15l7-6 7 6M10 13.5V21h3.5v-4h3v4H20v-7.5" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
});

export default function LocationMap({
  fixes, clusters, selected, home, focus, onSelectFix, className = '',
}: {
  fixes: MapFix[];
  clusters: MapCluster[];
  selected: (MapPoint & { id: number }) | null;
  home: MapPoint | null;
  focus?: MapFocus | null;
  onSelectFix?: (id: number) => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterLayer = useRef<L.LayerGroup | null>(null);
  const fixLayer = useRef<L.LayerGroup | null>(null);
  const homeLayer = useRef<L.LayerGroup | null>(null);
  const pinLayer = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelectFix);
  onSelectRef.current = onSelectFix;

  useEffect(() => {
    if (!hostRef.current) return;
    const map = L.map(hostRef.current, { zoomControl: true });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);
    clusterLayer.current = L.layerGroup().addTo(map);
    homeLayer.current = L.layerGroup().addTo(map);
    fixLayer.current = L.layerGroup().addTo(map);
    pinLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // The window animates open and the panel resizes with it.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Every fix and every group; the view fits all of them when they arrive.
  const fixKey = fixes.map((f) => f.id).join(',');
  useEffect(() => {
    const map = mapRef.current;
    const cl = clusterLayer.current;
    const fl = fixLayer.current;
    if (!map || !cl || !fl) return;
    cl.clearLayers();
    fl.clearLayers();
    for (const c of clusters) {
      const color = clusterColor(c.clusterNo);
      L.circle([c.lat, c.lon], {
        radius: Math.max(c.radiusM, MIN_RING_M), color, weight: 2, dashArray: '5 4', fillColor: color, fillOpacity: 0.08,
      }).bindTooltip(c.label, { direction: 'top' }).addTo(cl);
    }
    for (const f of fixes) {
      const color = clusterColor(f.clusterNo);
      L.circleMarker([f.lat, f.lon], { radius: 6, color: '#ffffff', weight: 1.5, fillColor: color, fillOpacity: 0.95 })
        .bindTooltip(f.label, { direction: 'top' })
        .on('click', () => onSelectRef.current?.(f.id))
        .addTo(fl);
    }
    const points: L.LatLngExpression[] = fixes.map((f) => [f.lat, f.lon]);
    if (home) points.push([home.lat, home.lon]);
    if (points.length === 1) map.setView(points[0], ZOOM);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 17 });
  }, [fixKey, clusters.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const layer = homeLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!home) return;
    if (home.radiusM) {
      L.circle([home.lat, home.lon], { radius: home.radiusM, color: '#16a34a', weight: 1, fillOpacity: 0.12 }).addTo(layer);
    }
    L.marker([home.lat, home.lon], { icon: homeIcon, keyboard: false, zIndexOffset: -100 }).addTo(layer);
    if (fixes.length === 0) mapRef.current?.setView([home.lat, home.lon], ZOOM);
  }, [home?.lat, home?.lon, home?.radiusM]); // eslint-disable-line react-hooks/exhaustive-deps

  // The chosen fix: a pin with its accuracy ring, brought into view if it is off it.
  useEffect(() => {
    const map = mapRef.current;
    const layer = pinLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!selected) return;
    if (selected.radiusM) {
      L.circle([selected.lat, selected.lon], { radius: selected.radiusM, color: '#dc2626', weight: 1, fillOpacity: 0.1 }).addTo(layer);
    }
    L.marker([selected.lat, selected.lon], { icon: pinIcon, keyboard: false, zIndexOffset: 1000 }).addTo(layer);
    const at = L.latLng(selected.lat, selected.lon);
    if (!map.getBounds().contains(at)) map.panTo(at);
  }, [selected?.id, selected?.lat, selected?.lon, selected?.radiusM]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    if (focus.radiusM) map.fitBounds(L.latLng(focus.lat, focus.lon).toBounds(Math.max(focus.radiusM, MIN_RING_M) * 3), { maxZoom: 18 });
    else map.setView([focus.lat, focus.lon], ZOOM);
  }, [focus?.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // `isolate` keeps Leaflet's own z-indexes (up to 1000) inside this box.
  return <div ref={hostRef} className={`isolate z-0 ${className}`} />;
}
