"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface ScannerProps {
  onScan: (decodedText: string) => void;
}

export interface ScannerHandle {
  stopScanner: () => Promise<void>;
}

type CameraDevice = { id: string; label: string };

const Scanner = forwardRef<ScannerHandle, ScannerProps>(({ onScan }, ref) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string>("");

  useImperativeHandle(ref, () => ({
    stopScanner: async () => {
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            await scannerRef.current.stop();
          }
          scannerRef.current.clear();
        } catch (e) {
          console.error("Error stopping scanner:", e);
        }
      }
    }
  }));

  const startScanning = async (cameraId: string) => {
    if (!scannerRef.current) return;
    
    if (scannerRef.current.isScanning) {
      await scannerRef.current.stop().catch(console.warn);
      scannerRef.current.clear();
    }

    try {
      await scannerRef.current.start(
        cameraId,
        {
          fps: 10,
          // MENGHAPUS qrbox & aspectRatio secara total! 
          // Membiarkan html5-qrcode memakai feed asli tanpa canvas overlay yang pecah (split 2) di beberapa device.
        },
        (decodedText) => onScan(decodedText),
        () => {} // Abaikan error per-frame "not found"
      );
    } catch (err) {
      console.warn("Failed to start camera:", err);
    }
  };

  useEffect(() => {
    const silenceAbortError = (event: PromiseRejectionEvent) => {
      if (event.reason && event.reason.name === 'AbortError') event.preventDefault();
    };
    window.addEventListener('unhandledrejection', silenceAbortError);

    scannerRef.current = new Html5Qrcode("reader");

    Html5Qrcode.getCameras().then(devices => {
      if (devices && devices.length > 0) {
        setCameras(devices);
        let defaultCam = devices[0].id;
        const backCam = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
        if (backCam) defaultCam = backCam.id;
        setActiveCameraId(defaultCam);
      }
    }).catch(err => console.error("Error getting cameras", err));

    return () => {
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop().then(() => scannerRef.current?.clear()).catch(console.warn);
        } else {
          scannerRef.current.clear();
        }
      }
      window.removeEventListener('unhandledrejection', silenceAbortError);
    };
  }, [onScan]);

  useEffect(() => {
    if (activeCameraId && scannerRef.current) {
      startScanning(activeCameraId);
    }
  }, [activeCameraId]);

  return (
    <div className="w-full flex flex-col gap-3">
      {cameras.length > 0 && (
        <div className="w-full px-1">
          <label className="text-[10px] uppercase font-bold text-gray-400 mb-1.5 block">Pilih Perangkat Kamera</label>
          <select 
            value={activeCameraId} 
            onChange={(e) => setActiveCameraId(e.target.value)}
            className="w-full bg-white border border-gray-300 text-slate-800 font-medium text-sm rounded-xl py-2 px-3 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          >
            {cameras.map((c, i) => (
              <option key={c.id} value={c.id}>{c.label || `Kamera ${i + 1}`}</option>
            ))}
          </select>
        </div>
      )}
      <div id="reader" className="w-full overflow-hidden rounded-xl border-2 border-gray-200 bg-black flex items-center justify-center min-h-[250px] relative"></div>
    </div>
  );
});

export default Scanner;
