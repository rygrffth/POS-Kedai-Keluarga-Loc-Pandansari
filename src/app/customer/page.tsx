"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import {
  ShoppingCart, Search, Trash2, Plus, Minus,
  CheckCircle2, AlertCircle, Maximize, User, ScanLine, X, Lock, Flame, Info, ShoppingBag, Download
} from "lucide-react";
import { playBeepSound } from "@/lib/sounds";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import ScalingContainer from "@/components/ScalingContainer";

const Scanner = dynamic(() => import("@/components/Scanner"), { ssr: false });

type CartItem = {
  variant: any;
  quantity: number;
};

export default function CustomerPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [manualCode, setManualCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [tableNumber, setTableNumber] = useState("");

  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [receiptData, setReceiptData] = useState<any | null>(null);
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false);

  const [mounted, setMounted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannerMode, setScannerMode] = useState<'hardware' | 'camera'>('hardware');
  const [bestSellers, setBestSellers] = useState<any[]>([]);


  // Konfirmasi scan state - REMOVED for instant scan
  // const [pendingScannedItem, setPendingScannedItem] = useState<any | null>(null);
  
  // Feedback states
  const [showToast, setShowToast] = useState(false);
  const [lastScanned, setLastScanned] = useState<any>(null);
  const [isPulsing, setIsPulsing] = useState(false);

  const toastTimer = useRef<NodeJS.Timeout | null>(null);
  const pulseTimer = useRef<NodeJS.Timeout | null>(null);


  const scannerRef = useRef<any>(null);

  // Hidden Admin Gateway (5 Taps)
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef<NodeJS.Timeout | null>(null);

  const handleSecretGateway = () => {
    setTapCount(prev => {
      const nextCount = prev + 1;
      if (nextCount >= 5) {
        localStorage.removeItem("pos_admin_role"); // FORCE Re-login every time!
        window.location.href = "/admin";
        return 0;
      }
      return nextCount;
    });

    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      setTapCount(0);
    }, 1500); // Reset tap count if pause > 1.5s
  };

  const handleBatalScan = async () => {
    if (scannerRef.current) await scannerRef.current.stopScanner();
    setCameraActive(false);
    setScannerMode('hardware');
  };


  useBarcodeScanner((barcode) => {
    if (!isCheckingOut) {
      if (cameraActive) handleBatalScan();
      else handleScan(barcode);
    }
  });


  useEffect(() => {
    setMounted(true);
    fetchBestSellers();
  }, []);

  const fetchBestSellers = async () => {
    const { data } = await supabase
      .from('product_variants')
      .select('*, products(name)')
      .order('sold_count', { ascending: false })
      .limit(6);
    if (data) setBestSellers(data);
  };

  const addItemToCart = (variant: any) => {
    if (!variant) return;

    setCart((prev) => {
      const existing = prev.find((item) => item.variant.id === variant.id);
      if (existing) {
        return prev.map((item) =>
          item.variant.id === variant.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { variant, quantity: 1 }];
    });

    // Visual/Audio Feedback
    playBeepSound();
    setLastScanned(variant);
    setShowToast(true);
    setIsPulsing(true);

    // Reset timers
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setShowToast(false), 3000);

    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setIsPulsing(false), 1000);
  };

  const handleScan = async (barcode: string) => {
    try {
      const { data, error } = await supabase
        .from("product_variants")
        .select("*, products(name)")
        .eq("barcode", barcode)
        .single();

      if (error || !data) {
        alert("❌ Barcode tidak ditemukan di database!");
        return;
      }

      addItemToCart(data);
    } catch (err: any) {
      alert("Error memindai: " + err.message);
    }
  };


  const updateQuantity = (variantId: string, delta: number) => {
    setCart((prev) => prev.map(item => {
      if (item.variant.id === variantId) {
        const newQ = item.quantity + delta;
        return newQ > 0 ? { ...item, quantity: newQ } : item;
      }
      return item;
    }));
  };

  const removeItem = (variantId: string) => {
    setCart(prev => prev.filter(item => item.variant.id !== variantId));
  };

  const requestCheckoutConfirmation = () => {
    if (!customerName.trim() || !tableNumber.trim()) {
      alert("⚠️ Harap isi Nama dan Nomor Meja terlebih dahulu!");
      return;
    }
    setShowCheckoutConfirm(true);
  };

  const handleCheckout = async () => {
    setShowCheckoutConfirm(false);
    if (cart.length === 0) return;
    setIsCheckingOut(true);

    try {
      const totalAmount = cart.reduce((sum, item) => sum + (item.variant.price || 0) * item.quantity, 0);

      const { data: trxData, error: trxError } = await supabase
        .from("transactions")
        .insert([{
          status: "pending",
          total_amount: totalAmount,
          customer_name: customerName,
          table_number: tableNumber
        }])
        .select()
        .single();

      if (trxError) throw new Error(trxError.message);

      const itemsToInsert = cart.map(item => ({
        transaction_id: trxData.id,
        variant_id: item.variant.id,
        quantity: item.quantity,
        unit_price: item.variant.price,
        subtotal: (item.variant.price || 0) * item.quantity
      }));

      const { error: itemsError } = await supabase
        .from("transaction_items")
        .insert(itemsToInsert);

      if (itemsError) throw new Error(itemsError.message);

      setReceiptData({ transactionId: trxData.id, items: cart, total: totalAmount, name: customerName, table: tableNumber });
      setCart([]);
      setCustomerName("");
      setTableNumber("");
      setManualCode("");
    } catch (err: any) {
      console.error(err);
      alert("Gagal menyelesaikan pesanan: " + (err?.message || "Error"));
    } finally {
      setIsCheckingOut(false);
    }
  };

  const total = cart.reduce((sum, item) => sum + (item.variant.price || 0) * item.quantity, 0);

  const handleDownloadReceipt = () => {
    const el = document.getElementById('customer-receipt');
    if (!el) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed'; iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`<html><head><title>Struk Kedai Keluarga</title><style>@page { margin: 10mm; } body { font-family: monospace; padding: 16px; color: black; font-size: 12px; } .text-center { text-align: center; } .font-bold { font-weight: bold; } .flex { display: flex; } .justify-between { justify-content: space-between; } .mb-1 { margin-bottom: 4px; } .mb-4 { margin-bottom: 16px; } .text-base { font-size: 16px; } .text-lg { font-size: 18px; } .text-xs { font-size: 10px; } .uppercase { text-transform: uppercase; } .font-black { font-weight: 900; } .font-medium { font-weight: 500; } .border-b-2 { border-bottom: 1px dashed black; margin: 8px 0; } .space-y-3 > * + * { margin-top: 8px; } .mt-6 { margin-top: 20px; } .pt-4 { padding-top: 12px; border-top: 1px solid #ccc; }</style></head><body>${el.innerHTML}</body></html>`);
      doc.close();
      setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); setTimeout(() => document.body.removeChild(iframe), 1000); }, 200);
    }
  };

  if (!mounted) return null;

  return (
    <ScalingContainer bg="bg-slate-900" baseWidth={480} baseHeight={960} mode="fit">
      <main className="h-full bg-slate-50 flex flex-col font-sans overflow-y-auto pb-32 relative">
        <div className="bg-slate-900 text-white p-5 lg:p-6 shadow-xl sticky top-0 z-10 flex justify-between items-center no-print w-full">
        <div onClick={handleSecretGateway} className="cursor-pointer select-none">
          <h1 className="text-xl lg:text-2xl font-black tracking-tight flex items-center gap-2">
            <ShoppingBag size={24} className="text-green-400" /> Kedai Keluarga
          </h1>
          <p className="text-xs text-slate-400 mt-1">Self-Service POS • Scan barcode barang Anda</p>
        </div>
        <div className={`bg-slate-800 p-2.5 rounded-2xl flex items-center gap-2 border border-slate-700 transition-all duration-300 ${isPulsing ? 'scale-110 border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]' : ''}`}>
          <ShoppingCart size={20} className={`text-green-400 ${isPulsing ? 'animate-bounce' : ''}`} />
          <span className="font-bold text-lg">{cart.length}</span>
        </div>

      </div>

      <div className="p-4 lg:p-8 max-w-lg mx-auto w-full no-print flex-1 space-y-6">

        {/* BEST SELLERS SECTION */}
        {bestSellers.length > 0 && cart.length === 0 && (
          <div className="mb-6 animate-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Flame size={18} className="text-orange-500" /> Terlaris Minggu Ini</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {bestSellers.map(item => (
                <div key={item.id} onClick={() => { addItemToCart(item); }} className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer active:scale-95 group flex flex-col items-center text-center">

                  <div className="w-16 h-16 rounded-full bg-slate-100 mb-2 overflow-hidden border border-slate-200 shadow-inner group-hover:shadow-md transition-shadow">
                    {item.image_url ? <img src={item.image_url} className="w-full h-full object-cover" alt="product" /> : <div className="w-full h-full flex items-center justify-center text-slate-300"><ShoppingCart size={24} /></div>}
                  </div>
                  <p className="font-bold text-slate-800 text-xs line-clamp-2 leading-tight">{item.variant_name || item.products?.name}</p>
                  <p className="text-blue-600 font-extrabold text-sm mt-1">Rp {(item.price || 0).toLocaleString('id-ID')}</p>
                  <p className="text-[9px] font-bold text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Order Sekarang</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SCANNER AREA */}
        <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 flex flex-col items-center overflow-hidden transition-all duration-500">
          
          {scannerMode === 'hardware' ? (
            <div className="w-full flex flex-col items-center py-4 animate-in fade-in zoom-in-95 duration-500">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-green-500/10 rounded-full animate-ping duration-[3000ms]" />
                <div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center relative z-10 border-2 border-green-100">
                  <ScanLine size={38} className="animate-pulse" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                </div>
              </div>
              
              <h2 className="text-xl font-black text-gray-800 mb-1">Siap Mendeteksi</h2>
              <p className="text-gray-400 text-xs text-center mb-6 px-4">Sistem standby. Silakan scan barcode barang Anda menggunakan alat scanner.</p>
              
              <div className="flex flex-col w-full gap-3">
                <button 
                  onClick={() => { setScannerMode('camera'); setCameraActive(true); }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-6 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 border border-slate-200 shadow-sm active:scale-95"
                >
                  <Maximize size={14} /> Gunakan Kamera
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest flex items-center gap-2">
                  <ScanLine size={16} className="text-blue-600" /> Mode Kamera
                </h2>
                <button onClick={handleBatalScan} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="w-full aspect-square max-w-[280px] mx-auto bg-slate-900 rounded-3xl overflow-hidden shadow-inner border-4 border-slate-100 relative mb-4">
                {!cameraActive ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-slate-800">
                    <AlertCircle size={40} className="mb-3 opacity-50" />
                    <p className="font-semibold text-sm">Kamera Nonaktif</p>
                    <button onClick={() => setCameraActive(true)} className="mt-4 bg-white text-slate-900 px-6 py-2 rounded-xl font-bold text-xs shadow-lg hover:bg-slate-100 active:scale-95 transition-all">Nyalakan Kamera</button>
                  </div>
                ) : (
                  <Scanner ref={scannerRef} onScan={handleScan} />
                )}
                <div className="absolute inset-x-8 inset-y-8 border-2 border-white/30 border-dashed rounded-2xl pointer-events-none" />
              </div>
              
              <p className="text-[10px] text-center text-gray-400 font-medium px-4 mb-2">Arahkan barcode ke dalam kotak untuk memindai otomatis</p>
            </div>
          )}

          <div className="w-full relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100"></div></div>
            <div className="relative flex justify-center text-[10px]"><span className="bg-white px-4 text-gray-300 font-bold uppercase tracking-widest">atau ketik manual</span></div>
          </div>

          <div className="flex w-full gap-2">
            <div className="relative flex-1">
              <input type="text" placeholder="Masukkan kode barang..." className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-3.5 pl-4 pr-10 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400 placeholder:font-normal" value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && manualCode) handleScan(manualCode); }} />
            </div>
            <button onClick={() => { if (manualCode) handleScan(manualCode); }} className="bg-blue-600 hover:bg-blue-700 text-white p-3.5 rounded-2xl shadow-lg shadow-blue-500/30 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center" disabled={!manualCode}>
              <Search size={20} />
            </button>
          </div>
        </div>

        {/* KERANJANG AREA */}
        {cart.length > 0 && (
          <div className="space-y-4 animate-in fade-in duration-300 pb-20">
            <h3 className="font-black text-gray-800 text-lg px-2">Daftar Belanja</h3>
            <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
              {cart.map((item) => (
                <div key={item.variant.id} className="p-4 flex gap-4 items-center">
                  <div className="w-14 h-14 bg-slate-50 rounded-2xl flex-shrink-0 flex items-center justify-center border border-gray-100 overflow-hidden">
                    {item.variant.image_url ? <img src={item.variant.image_url} className="w-full h-full object-cover" /> : <ShoppingCart size={24} className="text-gray-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 text-sm truncate pr-4">{item.variant.variant_name || item.variant.products?.name}</p>
                    <p className="text-blue-600 font-extrabold text-sm mb-2">Rp {(item.variant.price || 0).toLocaleString('id-ID')}</p>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center bg-gray-50 border border-gray-200 rounded-xl p-1">
                        <button onClick={() => updateQuantity(item.variant.id, -1)} className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-white hover:text-gray-800 hover:shadow-sm rounded-lg transition-all"><Minus size={16} /></button>
                        <span className="w-8 text-center font-bold text-sm text-gray-800">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.variant.id, 1)} className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-white hover:text-gray-800 hover:shadow-sm rounded-lg transition-all"><Plus size={16} /></button>
                      </div>
                      <button onClick={() => removeItem(item.variant.id)} className="p-2 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors ml-auto"><Trash2 size={18} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* TOAST FEEDBACK */}
      {showToast && lastScanned && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-none">
          <div className="bg-slate-900/90 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/10 flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/20">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-green-400 uppercase tracking-wider leading-none mb-1">Berhasil Ditambah</p>
              <p className="text-sm font-black leading-none">{lastScanned.variant_name || lastScanned.products?.name}</p>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM ADD TO CART MODAL - REMOVED for instant scan */}


      {/* CUSTOM CHECKOUT CONFIRMATION MODAL */}
      {showCheckoutConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex flex-col items-center justify-end p-0 animate-in fade-in duration-200 no-print">
          <div className="bg-white rounded-t-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl animate-in slide-in-from-bottom-full duration-300">
            <div className="p-1 flex justify-center"><div className="w-12 h-1.5 bg-gray-200 rounded-full my-3"></div></div>
            <div className="px-6 pb-6 text-center">
              <div className="w-20 h-20 mx-auto bg-blue-100 rounded-full mb-4 flex items-center justify-center text-blue-600">
                <Lock size={32} />
              </div>
              <h3 className="text-2xl font-black text-slate-800 mb-2">Selesaikan Belanja?</h3>
              <p className="text-sm text-gray-500 mb-6 px-4">Pesanan Atas Nama <b>{customerName}</b> (Meja <b>{tableNumber}</b>) akan dikunci dan dikirim ke Kasir.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowCheckoutConfirm(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-2xl transition-all">Batal</button>
                <button onClick={handleCheckout} className="flex-[2] bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-green-500/30 transition-all">Kirim Pesanan</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FIXED CHECKOUT BAR */}
      {cart.length > 0 && !receiptData && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)] z-20 animate-in slide-in-from-bottom-full duration-300">
          <div className="max-w-md mx-auto p-4 space-y-3">
            <div className="flex gap-2">
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 flex-[2] flex items-center gap-3">
                <User size={18} className="text-gray-400" />
                <input type="text" placeholder="Nama Anda (Wajib)" className="bg-transparent w-full text-sm font-bold text-slate-900 outline-none placeholder:font-normal placeholder-gray-400" value={customerName} onChange={e => setCustomerName(e.target.value)} />
              </div>
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 flex-1 flex items-center gap-2">
                <span className="text-slate-500 font-black text-[10px] uppercase tracking-wider">Meja</span>
                <input type="text" placeholder="No." className="bg-transparent w-full text-sm font-black text-blue-700 outline-none placeholder:font-normal placeholder-gray-400 uppercase text-center" value={tableNumber} onChange={e => setTableNumber(e.target.value)} maxLength={3} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 pl-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">Total Belanja</p>
                <p className="text-xl font-black text-gray-800 leading-none">
                  <span className="text-xs font-black text-slate-400 mr-1">RP</span>
                  {total.toLocaleString('id-ID')}
                </p>
              </div>
              <button onClick={requestCheckoutConfirmation} disabled={isCheckingOut || !customerName.trim() || !tableNumber.trim()} className="bg-green-500 hover:bg-green-600 text-white px-6 py-3.5 rounded-2xl font-black shadow-lg shadow-green-500/30 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center gap-2 text-sm uppercase tracking-wide">
                {isCheckingOut ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><CheckCircle2 size={20} /> Selesai Belanja</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= LOCK SCREEN MODAL RECEIPT CUSTOMER ================= */}
      {receiptData && (
        <div className="fixed inset-0 bg-slate-900 backdrop-blur-md z-50 overflow-y-auto no-print">
          <div className="min-h-full flex justify-center py-8 px-4">
            <div className="bg-white rounded-[2.5rem] w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 my-auto">
              <div className="bg-green-500 p-8 text-center text-white relative">
                <Lock size={48} className="mx-auto mb-3 opacity-90" />
                <h2 className="text-3xl font-black tracking-tight leading-none mb-2">Keranjang Dikunci</h2>
                <p className="text-green-100 text-sm font-medium bg-green-600/50 p-2 rounded-xl mt-3 flex items-center justify-center gap-2"><Info size={16} /> Silakan tunjukkan layar ini ke kasir</p>
              </div>

              {/* The Actual Receipt Layout for printing/screenshot */}
              <div id="customer-receipt" className="p-6 bg-slate-50 font-mono text-xs text-black">
                <div className="text-center font-bold text-base mb-1">KEDAI KELUARGA</div>
                <div className="text-center mb-4 text-gray-500">Struk Antrean • Tunjukkan ke Kasir</div>
                <div className="border-b-2 border-dashed border-gray-300 mb-4"></div>

                <div className="flex justify-between mb-1">
                  <span className="text-gray-500">Nama Pemesan:</span>
                  <span className="font-bold uppercase text-sm">{receiptData.name}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-500">Meja:</span>
                  <span className="font-bold uppercase text-sm">{receiptData.table}</span>
                </div>
                <div className="flex justify-between mb-4">
                  <span className="text-gray-500">Waktu:</span>
                  <span className="font-medium">{new Date().toLocaleString('id-ID')}</span>
                </div>

                <div className="border-b-2 border-dashed border-gray-300 mb-4"></div>

                <div className="space-y-3 mb-4">
                  {receiptData.items.map((item: any, i: number) => (
                    <div key={i}>
                      <div className="font-bold text-gray-800">{item.variant.variant_name || item.variant.products?.name || "Item"}</div>
                      <div className="flex justify-between text-gray-600 mt-0.5">
                        <span>{item.quantity} x {(item.variant.price || 0).toLocaleString('id-ID')}</span>
                        <span className="font-bold text-gray-900">{(item.quantity * (item.variant.price || 0)).toLocaleString('id-ID')}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-b-2 border-dashed border-gray-300 mb-4"></div>

                <div className="flex justify-between text-base font-black text-gray-900 mb-4">
                  <span>TOTAL</span>
                  <span className="text-lg">Rp {receiptData.total.toLocaleString('id-ID')}</span>
                </div>

                <div className="text-center text-[10px] text-gray-400 mt-6 pt-4 border-t border-gray-200">
                  ID: {receiptData.transactionId}
                </div>
              </div>

              <div className="p-5 bg-white border-t border-gray-200 no-print space-y-2">
                <button
                  onClick={handleDownloadReceipt}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-2xl transition-all active:scale-95"
                >
                  <Download size={18} /> Download / Cetak Struk
                </button>
                <button
                  onClick={() => { setReceiptData(null); window.scrollTo(0, 0); }}
                  className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 px-4 rounded-2xl transition-all"
                >
                  Buat Pesanan Baru
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </main>
    </ScalingContainer>
  );
}
