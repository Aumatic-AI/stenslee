"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

export default function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "captured" | "error">("loading");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    stream?.getTracks().forEach((t) => t.stop());
    setStatus("loading");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
      setStream(s);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [stream]);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function capture() {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    const url = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedUrl(url);
    setStatus("captured");
    stream?.getTracks().forEach((t) => t.stop());
  }

  function retake() {
    setCapturedUrl(null);
    startCamera(facingMode);
  }

  function flipCamera() {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  }

  function usePhoto() {
    if (capturedUrl) {
      onCapture(capturedUrl);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      {/* Camera view */}
      <div className="flex-1 relative overflow-hidden">
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              <p className="text-muted text-sm font-cinzel">Starting camera…</p>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <div className="text-center flex flex-col gap-4">
              <p className="text-error font-cinzel text-lg font-bold">Camera Unavailable</p>
              <p className="text-muted text-sm">Camera permission was denied or no camera was found.</p>
              <button
                onClick={onClose}
                className="px-6 py-3 bg-surface border border-cleo-border rounded-xl text-ink text-sm font-cinzel"
              >
                Close
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {status === "captured" && capturedUrl ? (
            <motion.img
              key="captured"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              src={capturedUrl}
              alt="Captured"
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <video
              key="video"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: facingMode === "user" ? "scaleX(-1)" : "none" }}
            />
          )}
        </AnimatePresence>

        {/* Guide frame */}
        {status === "ready" && (
          <div className="absolute inset-8 border border-gold/30 rounded-xl pointer-events-none">
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-gold rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-gold rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-gold rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-gold rounded-br-lg" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-bg/95 backdrop-blur-sm px-6 py-6 flex items-center justify-between safe-area-bottom">
        <button
          onClick={onClose}
          className="text-muted hover:text-gold transition-colors font-cinzel text-sm tracking-wide"
        >
          Cancel
        </button>

        {status === "ready" ? (
          <>
            {/* Capture button */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={capture}
              className="w-18 h-18 rounded-full border-4 border-gold flex items-center justify-center"
              style={{ width: 72, height: 72 }}
            >
              <div className="w-14 h-14 rounded-full bg-gold" />
            </motion.button>
            <button onClick={flipCamera} className="text-muted hover:text-gold transition-colors">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5m0 0v5m0-5l-6 6M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28..." />
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l16 16" />
              </svg>
              <span className="text-[10px] font-mono block mt-0.5">Flip</span>
            </button>
          </>
        ) : status === "captured" ? (
          <>
            <button
              onClick={retake}
              className="text-muted hover:text-ink font-cinzel text-sm tracking-wide transition-colors"
            >
              ↺ Retake
            </button>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={usePhoto}
              className="bg-gold text-bg font-cinzel font-bold text-sm tracking-wide px-8 py-3 rounded-xl"
            >
              Use This Photo
            </motion.button>
          </>
        ) : null}
      </div>
    </motion.div>
  );
}
