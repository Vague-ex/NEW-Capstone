/**
 * A small map showing the graduate's pinned home location, with a draggable pin.
 *
 * GPS indoors is often off by tens of metres, so the pin can be corrected by
 * dragging it or tapping the map. On phones the map does NOT pan on a one-finger
 * drag: a full-width map that captures touch drags makes the rest of the form
 * impossible to scroll past. Tapping still moves the pin, and the pin itself is
 * still draggable.
 *
 * Leaflet is loaded on demand, the same way the admin geomap and the graduate
 * portal's workplace map load it.
 */
import { useEffect, useRef } from 'react';

type LatLng = { lat: number; lng: number };

/** Only the Leaflet members this component uses. */
interface LeafletMarker {
  addTo(map: LeafletMap): LeafletMarker;
  getLatLng(): LatLng;
  setLatLng(latlng: [number, number] | LatLng): LeafletMarker;
  on(event: 'dragend', handler: () => void): LeafletMarker;
}
interface LeafletMap {
  on(event: 'click', handler: (e: { latlng: LatLng }) => void): LeafletMap;
  setView(center: [number, number], zoom: number): LeafletMap;
  getZoom(): number;
  invalidateSize(): void;
  remove(): void;
}
interface LeafletModule {
  map(el: HTMLElement, options: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, options: Record<string, unknown>): { addTo(map: LeafletMap): unknown };
  marker(latlng: [number, number], options: Record<string, unknown>): LeafletMarker;
  icon(options: Record<string, unknown>): unknown;
  Browser: { mobile: boolean };
}

const LEAFLET_CDN = 'https://unpkg.com/leaflet@1.9.4/dist';

export default function HomeLocationMap({
  lat,
  lng,
  onMove,
}: {
  lat: number;
  lng: number;
  /** Called when the graduate drags the pin or taps the map. */
  onMove: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  // Leaflet handlers are bound once; read the latest callback through a ref.
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  // Create the map once. Position changes are applied by the effect below.
  useEffect(() => {
    if (!document.getElementById('leaflet-css-link')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css-link';
      link.rel = 'stylesheet';
      link.href = `${LEAFLET_CDN}/leaflet.css`;
      document.head.appendChild(link);
    }

    let cancelled = false;
    let sizeTimer: ReturnType<typeof setTimeout> | undefined;
    void import('leaflet').then((mod) => {
      const L = (mod.default ?? mod) as unknown as LeafletModule;
      if (cancelled || !containerRef.current || mapRef.current) return;

      // An explicit icon: Leaflet's default icon URLs break under bundlers,
      // leaving a zero-size marker that cannot be dragged.
      const icon = L.icon({
        iconUrl: `${LEAFLET_CDN}/images/marker-icon.png`,
        iconRetinaUrl: `${LEAFLET_CDN}/images/marker-icon-2x.png`,
        shadowUrl: `${LEAFLET_CDN}/images/marker-shadow.png`,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        shadowSize: [41, 41],
      });

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 17,
        scrollWheelZoom: false,
        dragging: !L.Browser.mobile,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker([lat, lng], { icon, draggable: true, autoPan: true }).addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onMoveRef.current(pos.lat, pos.lng);
      });
      map.on('click', (e) => {
        marker.setLatLng(e.latlng);
        onMoveRef.current(e.latlng.lat, e.latlng.lng);
      });

      mapRef.current = map;
      markerRef.current = marker;
      // The map mounts inside a section that has just appeared; without a size
      // recalculation the tiles and the drag handle land in the wrong place.
      sizeTimer = setTimeout(() => map.invalidateSize(), 200);
    });

    return () => {
      cancelled = true;
      if (sizeTimer) clearTimeout(sizeTimer);
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Created once on mount; lat/lng updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow a new GPS fix without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const current = marker.getLatLng();
    if (Math.abs(current.lat - lat) > 1e-7 || Math.abs(current.lng - lng) > 1e-7) {
      marker.setLatLng([lat, lng]);
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    }
  }, [lat, lng]);

  return (
    <div
      ref={containerRef}
      // isolate: Leaflet's panes use z-index 400+, which would otherwise draw
      // the map over the sticky registration header while scrolling.
      className="isolate h-44 sm:h-56 w-full overflow-hidden rounded-lg border border-emerald-100 bg-gray-100"
      role="application"
      aria-label="Map of your pinned home location. Drag the pin or tap the map to move it."
    />
  );
}
