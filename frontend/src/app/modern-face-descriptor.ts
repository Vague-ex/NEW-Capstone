const MODEL_URI = '/modern-face-models';
const DESCRIPTOR_LENGTH = 128;
const FACE_DISTANCE_SIMILARITY_SCALE = 1.5;
export const FACE_MATCH_SIMILARITY_THRESHOLD = 0.5;
export const FACE_MATCH_DISTANCE_THRESHOLD =
    (1 - FACE_MATCH_SIMILARITY_THRESHOLD) * FACE_DISTANCE_SIMILARITY_SCALE;

let faceApiPromise: Promise<typeof import('modern-face-api')> | null = null;
let modelsLoadedPromise: Promise<void> | null = null;

async function getFaceApi() {
    if (!faceApiPromise) {
        faceApiPromise = import('modern-face-api');
    }
    return faceApiPromise;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load face image for descriptor extraction.'));
        image.src = dataUrl;
    });
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string') {
                resolve(result);
                return;
            }
            reject(new Error('Failed to convert face scan blob to data URL.'));
        };
        reader.onerror = () => reject(new Error('Failed to read face scan blob.'));
        reader.readAsDataURL(blob);
    });
}

export async function ensureModernFaceModelsLoaded(): Promise<void> {
    if (typeof window === 'undefined') {
        return;
    }

    if (!modelsLoadedPromise) {
        modelsLoadedPromise = (async () => {
            const faceapi = await getFaceApi();
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URI),
                faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URI),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URI),
            ]);
        })();
    }

    await modelsLoadedPromise;
}

export async function extractFaceDescriptorFromDataUrl(dataUrl: string): Promise<number[] | null> {
    if (typeof window === 'undefined') {
        return null;
    }

    await ensureModernFaceModelsLoaded();
    const faceapi = await getFaceApi();
    const image = await loadImage(dataUrl);

    const detection = await faceapi
        .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.60 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

    if (!detection || !detection.descriptor) {
        return null;
    }

    const descriptor = Array.from(detection.descriptor);
    if (descriptor.length !== DESCRIPTOR_LENGTH) {
        return null;
    }

    return descriptor;
}

export async function extractFaceDescriptorFromBlob(blob: Blob): Promise<number[] | null> {
    const dataUrl = await blobToDataUrl(blob);
    return extractFaceDescriptorFromDataUrl(dataUrl);
}

export function averageFaceDescriptors(descriptors: number[][]): number[] | null {
    const valid = descriptors.filter((descriptor) => Array.isArray(descriptor) && descriptor.length === DESCRIPTOR_LENGTH);
    if (valid.length === 0) {
        return null;
    }

    const sum = new Array<number>(DESCRIPTOR_LENGTH).fill(0);
    for (const descriptor of valid) {
        for (let index = 0; index < DESCRIPTOR_LENGTH; index += 1) {
            sum[index] += descriptor[index];
        }
    }

    return sum.map((value) => value / valid.length);
}

export function compareFaceDescriptors(
    descriptor1: number[],
    descriptor2: number[],
): { distance: number; similarity: number; isMatch: boolean } {
    if (descriptor1.length !== descriptor2.length) {
        throw new Error('Descriptors have different lengths');
    }

    let sum = 0;
    for (let i = 0; i < descriptor1.length; i += 1) {
        const delta = descriptor1[i] - descriptor2[i];
        sum += delta * delta;
    }

    const distance = Math.sqrt(sum);
    const similarity = Math.max(0, Math.min(1, 1 - distance / FACE_DISTANCE_SIMILARITY_SCALE));
    const isMatch = similarity >= FACE_MATCH_SIMILARITY_THRESHOLD;

    return { distance, similarity, isMatch };
}

export async function verifyFaceAgainstStored(
    currentDescriptor: number[],
    storedDescriptors: number[][],
    threshold: number = FACE_MATCH_DISTANCE_THRESHOLD,
): Promise<{ isMatch: boolean; bestDistance: number; bestSimilarity: number }> {
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const storedDescriptor of storedDescriptors) {
        if (!Array.isArray(storedDescriptor) || storedDescriptor.length !== currentDescriptor.length) {
            continue;
        }

        const { distance } = compareFaceDescriptors(currentDescriptor, storedDescriptor);
        if (distance < bestDistance) {
            bestDistance = distance;
        }
    }

    if (!Number.isFinite(bestDistance)) {
        return { isMatch: false, bestDistance: Number.POSITIVE_INFINITY, bestSimilarity: 0 };
    }

    const bestSimilarity = Math.max(0, Math.min(1, 1 - bestDistance / FACE_DISTANCE_SIMILARITY_SCALE));
    const isMatch = bestDistance <= threshold;

    return { isMatch, bestDistance, bestSimilarity };
}
