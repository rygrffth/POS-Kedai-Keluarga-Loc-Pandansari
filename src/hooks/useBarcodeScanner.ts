import { useEffect, useRef } from "react";

export function useBarcodeScanner(onScan: (barcode: string) => void) {
  const bufferRef = useRef("");
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Abaikan jika user menahan tombol
      if (e.repeat) return;

      // Jika menekan Enter, cek buffer
      if (e.key === "Enter") {
        if (bufferRef.current.length >= 3) {
          // Jika sedang fokus di dalam input, biarkan input/form tersebut yang menangani (mencegah double-scan)
          if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
            bufferRef.current = "";
            return;
          }

          // Hanya pancarkan event scan jika panjang char masuk akal untuk barcode
          onScan(bufferRef.current);
          bufferRef.current = "";
          e.preventDefault();
        }
        return;
      }

      // Jika karakter yang ditekan adalah single karakter (bukan Shift, Ctrl, dll)
      if (e.key.length === 1) {
        // Jika sedang fokus ke input teks, dan buffernya kosong, jangan ganggu ketikan normal pertama
        // Namun scanner mengetik sangat cepat, sehingga kita tetap simpan ke buffer
        bufferRef.current += e.key;

        // Reset timer. Scanner fisik biasanya mengirim 1 karakter per < 20ms
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          bufferRef.current = ""; // Kosongkan buffer jika sudah lebih dari 50ms (berarti diketik manual oleh manusia)
        }, 50);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onScan]);
}
