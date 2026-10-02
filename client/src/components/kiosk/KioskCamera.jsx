import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw } from 'lucide-react';

import KioskButton from './KioskButton';

/** The longest side of the photo sent. Enough to recognise a face at the counter. */
const MAX_SIDE = 1000;

/** Draw a source onto a canvas no larger than MAX_SIDE, as a JPEG data URL. */
function toDataUrl(source, width, height, mirror = false) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (mirror) {
    // The preview is mirrored so it behaves like a mirror; the stored photo
    // is not, so writing on a shirt reads the right way round.
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * The seller's photo, taken on the tablet's front camera.
 *
 * ## The live camera, and nothing else (client ruling, 2026-10-01)
 *
 * `getUserMedia` gives a live mirror and one tap to take the picture, which is
 * what a person standing at a tablet expects. There used to be a fallback, a
 * file input with `capture="user"`, and on several tablets and every desktop
 * browser that opens the photo gallery rather than the camera: a seller could
 * hand in somebody else's picture, which defeats the point of taking one. So
 * the only way in is the live camera. When it will not open, the screen says
 * so and offers to try again. The usual causes are a page not served over
 * HTTPS (the camera API does not exist there) and camera permission refused
 * for the site, both of which staff fix once in the tablet's browser.
 *
 * The result is a JPEG data URL, sent with the sale and stored privately by
 * the server.
 *
 * The stream is stopped the moment it is not needed, so the camera light on
 * the tablet is never on for the next customer.
 */
export function KioskCamera({ value, onChange }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLive(false);
  }, []);

  const start = useCallback(async () => {
    setFailed(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setLive(true);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!value) start();
    return stop;
    // Started once for a screen without a photo; retake starts it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function take() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    onChange(toDataUrl(video, video.videoWidth, video.videoHeight, true));
    stop();
  }

  function retake() {
    onChange('');
    start();
  }

  if (value) {
    return (
      <div className="text-center">
        <img
          src={value}
          alt="Your photo"
          width={480}
          height={360}
          className="mx-auto aspect-[4/3] w-full max-w-md rounded-xl border border-line object-cover"
        />
        <KioskButton tone="quiet" onClick={retake} className="mx-auto mt-4">
          <RotateCcw className="size-5" strokeWidth={2} aria-hidden="true" />
          Take it again
        </KioskButton>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="text-center">
        <p className="mb-4 text-lg text-ink-500">
          The camera did not open. Try again, or ask a member of staff to allow the camera on
          this tablet.
        </p>
        <KioskButton onClick={start} className="mx-auto">
          <Camera className="size-6" strokeWidth={2} aria-hidden="true" />
          Try the camera again
        </KioskButton>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-xl border border-line bg-ink-900">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Camera preview"
          className="size-full -scale-x-100 object-cover"
        />
        {!live && (
          <p className="absolute inset-0 flex items-center justify-center text-lg text-white/80">
            Opening the camera…
          </p>
        )}
      </div>
      <KioskButton onClick={take} disabled={!live} className="mx-auto mt-4">
        <Camera className="size-6" strokeWidth={2} aria-hidden="true" />
        Take photo
      </KioskButton>
    </div>
  );
}

export default KioskCamera;
