"use client";

import Link from "next/link";
import { Store, ShoppingBag } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-24 h-24 bg-blue-600 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-500/30">
          <Store size={48} className="text-white" />
        </div>
        
        <h1 className="text-4xl font-black text-slate-800 tracking-tight mb-2">KEDAI KELUARGA</h1>
        <p className="text-slate-500 font-medium mb-12">Pilih mode aplikasi untuk memulai</p>
        
        <div className="space-y-4">
          <Link href="/customer" className="group flex items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-xl hover:border-green-500 transition-all cursor-pointer">
            <div className="w-16 h-16 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center group-hover:bg-green-500 group-hover:text-white transition-colors">
              <ShoppingBag size={28} />
            </div>
            <div className="text-left">
              <h2 className="text-xl font-bold text-slate-800">Mode Pelanggan</h2>
              <p className="text-slate-500 text-sm">Masuk untuk memesan mandiri</p>
            </div>
          </Link>

          <Link href="/admin" className="group flex items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-xl hover:border-blue-500 transition-all cursor-pointer">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-500 group-hover:text-white transition-colors">
              <Store size={28} />
            </div>
            <div className="text-left">
              <h2 className="text-xl font-bold text-slate-800">Mode Kasir & Admin</h2>
              <p className="text-slate-500 text-sm">Kelola pesanan, meja, & laporan</p>
            </div>
          </Link>
        </div>

        <p className="text-xs text-slate-400 mt-12 font-medium">Enterprise Web POS Version 2.0</p>
      </div>
    </main>
  );
}
