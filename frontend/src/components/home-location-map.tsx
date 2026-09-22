/**
 * A small map showing a pinned location (home or workplace), with a draggable pin.
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
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Maximize2 } from 'lucide-react';

type LatLng = { lat: number; lng: number };

type Toggle = { enable(): void; disable(): void; enabled(): boolean };
/** The Leaflet map members MapFrame needs. */
export type ExpandableMap = { invalidateSize(): void; dragging: Toggle; scrollWheelZoom: Toggle };

/**
 * A Leaflet container with an Enlarge button that opens it full screen, on PC
 * and phone alike. CSS rather than the Fullscreen API: iPhones and the app's
 * WebView do not support element fullscreen. While enlarged, one-finger
 * panning and wheel zoom are on (there is no page behind to scroll).
 *
 * The container's own class never changes: Leaflet adds classes to it, and a
 * React className update would wipe them. The box around it takes the size.
 */
export function MapFrame({
  containerRef,
  getMap,
  label,
  title,
  className,
  frameClassName = '',
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  getMap: () => ExpandableMap | null;
  label: string;
  /** Heading shown above the enlarged map. */
  title: string;
  /** Size and border of the map while inline. */
  className: string;
  /** Layout classes for the whole frame while inline. */
  frameClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const getMapRef = useRef(getMap);
  useEffect(() => {
    getMapRef.current = getMap;
  }, [getMap]);
  const inline = useRef<{ drag: boolean; wheel: boolean } | null>(null);

  useEffect(() => {
    const map = getMapRef.current();
    if (!map || (!expanded && !inline.current)) return;
    if (expanded) {
      inline.current = { drag: map.dragging.enabled(), wheel: map.scrollWheelZoom.enabled() };
      map.dragging.enable();
      map.scrollWheelZoom.enable();
    } else if (inline.current) {
      if (!inline.current.drag) map.dragging.disable();
      if (!inline.current.wheel) map.scrollWheelZoom.disable();
    }
    // The box just changed size (already committed, so layout is current);
    // Leaflet only notices window resizes by itself.
    map.invalidateSize();
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <div
      className={expanded
        ? 'fixed inset-0 z-[1000] flex flex-col gap-2 bg-white px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6'
        : `relative ${frameClassName}`}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? title : undefined}
    >
      {expanded && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <p className="text-xs text-gray-500">Drag the pin or tap the map to move it.</p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={() => setExpanded(false)}
            className="min-h-11 shrink-0 rounded-xl bg-[#166534] px-5 text-sm font-semibold text-white hover:bg-[#14532d]"
          >
            Done
          </button>
        </div>
      )}
      <div className={`relative overflow-hidden ${expanded ? 'min-h-0 flex-1 rounded-lg border border-gray-200' : className}`}>
        <div
          ref={containerRef}
          // isolate: Leaflet's panes use z-index 400+, which would otherwise
          // draw the map over sticky headers and sidebars while scrolling.
          className="isolate absolute inset-0 bg-gray-100"
          role="application"
          aria-label={label}
        />
      </div>
      {!expanded && (
        // No z-index: coming after the map in the DOM already puts it on top,
        // and a z-index would lift it over sticky headers too.
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Enlarge map"
          className="absolute right-2 top-2 flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <Maximize2 className="size-4" aria-hidden />
          <span>Enlarge</span>
        </button>
      )}
    </div>
  );
}

/** Only the Leaflet members this component uses. */
interface LeafletMarker {
  addTo(map: LeafletMap): LeafletMarker;
  getLatLng(): LatLng;
  setLatLng(latlng: [number, number] | LatLng): LeafletMarker;
  on(event: 'dragend', handler: () => void): LeafletMarker;
}
interface LeafletMap extends ExpandableMap {
  on(event: 'click', handler: (e: { latlng: LatLng }) => void): LeafletMap;
  setView(center: [number, number], zoom: number): LeafletMap;
  getZoom(): number;
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
  zoom = 17,
  label = 'Map of your pinned home location. Drag the pin or tap the map to move it.',
  title = 'Home location',
}: {
  lat: number;
  lng: number;
  /** Called when the graduate drags the pin or taps the map. */
  onMove: (lat: number, lng: number) => void;
  /** Street level for an exact fix; pass a wider zoom for a rough, city-level pin. */
  zoom?: number;
  label?: string;
  /** Heading of the enlarged map. */
  title?: string;
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
        zoom,
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
      // A rough pin zooms out to show the city; a precise one zooms in.
      map.setView([lat, lng], zoom >= 16 ? Math.max(map.getZoom(), zoom - 1) : zoom);
    }
  }, [lat, lng, zoom]);

  return (
    <MapFrame
      containerRef={containerRef}
      getMap={() => mapRef.current}
      label={label}
      title={title}
      className="h-48 w-full rounded-lg border border-emerald-100 sm:h-64 lg:h-80"
    />
  );
}
