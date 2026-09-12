/**
 * Shared face-mesh overlay.
 *
 * Extracted from the debug page so registration, login and diagnostics draw the
 * same thing. Beyond avoiding three copies, it means a graduate sees exactly
 * what an admin sees when they later look at a capture problem.
 *
 * Why show it at all: the capture gates are invisible. When a blink will not
 * register or a frontal lock will not take, the user has no way to tell whether
 * the system can even see their face. The mesh answers that continuously, and
 * it makes the moment detection is LOST obvious rather than silent.
 */

export interface Point2D {
    x: number;
    y: number;
}

/**
 * face-api's 68-point layout, grouped. Indices are fixed by the model.
 *
 * The eye and mouth groups are called out because they are not decoration: EAR
 * comes from the eye points and MAR from the inner lip. Seeing those points sit
 * badly explains a wrong reading immediately -- the landmarks are wrong, not
 * the threshold.
 */
const LANDMARK_GROUPS: {
    from: number;
    to: number;
    closed: boolean;
    role: 'ear' | 'mar' | 'frame';
}[] = [
    { from: 0, to: 16, closed: false, role: 'frame' },
    { from: 17, to: 21, closed: false, role: 'frame' },
    { from: 22, to: 26, closed: false, role: 'frame' },
    { from: 27, to: 30, closed: false, role: 'frame' },
    { from: 31, to: 35, closed: false, role: 'frame' },
    { from: 36, to: 41, closed: true, role: 'ear' },
    { from: 42, to: 47, closed: true, role: 'ear' },
    { from: 48, to: 59, closed: true, role: 'mar' },
    { from: 60, to: 67, closed: true, role: 'mar' },
];

export const MESH_COLORS: Record<'ear' | 'mar' | 'frame', string> = {
    ear: '#34d399', // eyes — drive EAR / blink detection
    mar: '#fbbf24', // mouth — drives MAR
    frame: '#ffffff', // jaw, brows, nose — orientation only
};

export interface DrawMeshOptions {
    /**
     * Overall opacity. Registration and login use a low value so the mesh reads
     * as a guide rather than a mask over the user's own face; the debug page
     * uses a high one because there the mesh IS the subject.
     */
    alpha?: number;
    /** Draw the connecting lines, not just the points. */
    lines?: boolean;
}

/**
 * Paint the mesh onto a canvas overlaying a video.
 *
 * The canvas is sized to the video's INTRINSIC dimensions by this function, and
 * the caller must give it the same CSS box and object-fit as the video. The
 * browser then applies one identical transform to both, so landmarks can be
 * drawn in raw model coordinates with no manual scale/offset maths -- which is
 * where this sort of overlay usually drifts out of alignment.
 *
 * Passing `positions: null` clears the canvas, which is also how a caller
 * should wipe a stale mesh when the camera stops.
 */
export function drawFaceMesh(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement,
    positions: Point2D[] | null,
    options: DrawMeshOptions = {},
): void {
    const { alpha = 1, lines = true } = options;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!positions || positions.length < 68 || canvas.width === 0) return;

    const dotR = Math.max(1.2, canvas.width / 500);
    ctx.lineWidth = Math.max(1, canvas.width / 780);
    ctx.globalAlpha = alpha;

    for (const group of LANDMARK_GROUPS) {
        const pts = positions.slice(group.from, group.to + 1);
        if (pts.length === 0) continue;
        const color = MESH_COLORS[group.role];

        if (lines) {
            ctx.strokeStyle = color;
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            if (group.closed) ctx.closePath();
            ctx.stroke();
        }

        ctx.fillStyle = color;
        for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, group.role === 'frame' ? dotR : dotR * 1.35, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Leave the context as found; a shared canvas would otherwise inherit this.
    ctx.globalAlpha = 1;
}

/** Clear an overlay without needing the video's current dimensions. */
export function clearFaceMesh(canvas: HTMLCanvasElement | null): void {
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}
