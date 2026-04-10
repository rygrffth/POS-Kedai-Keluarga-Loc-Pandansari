"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import {
  CheckCircle, PackageSearch, ListOrdered, Plus, Search,
  Save, Printer, Smartphone, Download, X, History, ScanLine, RotateCcw,
  Ban, ShoppingBag, BarChart3, CalendarDays, Trash2, Edit, LayoutGrid, Lock,
  DollarSign, TrendingUp, Receipt, Clock, PlusCircle, AlertCircle, Settings,
  FileSpreadsheet, Sheet, ExternalLink, Loader2, ArrowUpRight, ArrowDownRight,
  ShoppingCart, PieChart as PieChartIcon,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend } from "recharts";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { exportTransactionsXlsx, exportInventoryXlsx, exportFullReportXlsx } from "@/lib/exportXlsx";
import { syncToGoogleSheets } from "@/lib/googleSheets";

const Scanner = dynamic(() => import("@/components/Scanner"), { ssr: false });

type AnalyticsPeriod =
  | "today"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisYear"
  | "custom";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfWeekMonday(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function getAnalyticsRange(
  period: AnalyticsPeriod,
  customFrom: string,
  customTo: string,
  now: Date = new Date()
): { start: Date; end: Date; label: string } {
  const n = new Date(now);
  switch (period) {
    case "today":
      return { start: startOfDay(n), end: endOfDay(n), label: "Hari Ini" };
    case "thisWeek": {
      const start = startOfWeekMonday(n);
      return { start, end: endOfDay(n), label: "Minggu Ini" };
    }
    case "lastWeek": {
      const thisMon = startOfWeekMonday(n);
      const lastMon = new Date(thisMon);
      lastMon.setDate(lastMon.getDate() - 7);
      const lastSun = new Date(thisMon);
      lastSun.setDate(lastSun.getDate() - 1);
      return { start: startOfDay(lastMon), end: endOfDay(lastSun), label: "Minggu Lalu" };
    }
    case "thisMonth":
      return {
        start: startOfDay(new Date(n.getFullYear(), n.getMonth(), 1)),
        end: endOfDay(n),
        label: "Bulan Ini",
      };
    case "lastMonth": {
      const first = new Date(n.getFullYear(), n.getMonth() - 1, 1);
      const last = new Date(n.getFullYear(), n.getMonth(), 0);
      return { start: startOfDay(first), end: endOfDay(last), label: "Bulan Lalu" };
    }
    case "thisYear":
      return {
        start: startOfDay(new Date(n.getFullYear(), 0, 1)),
        end: endOfDay(n),
        label: "Tahun Ini",
      };
    case "custom": {
      const from = customFrom
        ? new Date(customFrom + "T00:00:00")
        : startOfDay(new Date(n.getFullYear(), n.getMonth(), 1));
      const to = customTo
        ? new Date(customTo + "T23:59:59.999")
        : endOfDay(n);
      return {
        start: from,
        end: to,
        label:
          customFrom && customTo
            ? `${new Date(customFrom).toLocaleDateString("id-ID", { day: "numeric", month: "short" })} – ${new Date(customTo).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`
            : "Rentang Kustom",
      };
    }
  }
}

function previousEqualPeriod(start: Date, end: Date): { start: Date; end: Date } {
  const len = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - len);
  return { start: prevStart, end: prevEnd };
}

function growthPct(curr: number, prev: number): number | null {
  if (prev === 0 && curr === 0) return 0;
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

/** Kategori dari nama produk/varian (tanpa kolom DB). */
function inferSaleCategory(productName: string, variantName: string): string {
  const s = `${productName} ${variantName}`.toLowerCase();
  if (
    /\b(kopi|teh|jus|susu|minuman|es |air |sprite|coca|fanta|latte|cappuccino|americano|juice|soda|pop ice|boba|matcha|mineral)\b/.test(s)
  )
    return "Minuman";
  if (/\b(kerupuk|keripik|snack|biskuit|permen|coklat|gorengan|kacang|makaroni|chitato)\b/.test(s)) return "Snack";
  if (
    /\b(nasi|mie|ayam|ikan|sate|bakso|gado|rendang|goreng|soto|bakwan|ketoprak|pecel|burger|pizza|roti|sandwich|martabak|lontong|ketupat|opor|nugget)\b/.test(s)
  )
    return "Makanan";
  return "Lainnya";
}

function aggregatePeriodMetrics(
  history: any[],
  expenses: any[],
  start: Date,
  end: Date
) {
  let omzet = 0;
  let hpp = 0;
  let trxCount = 0;
  const payMethodMap: Record<string, number> = { Tunai: 0, QRIS: 0, Transfer: 0, Lainnya: 0 };
  const hourMap: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = 0;
  const sellerMap: Record<string, number> = {};
  const categoryRevenue: Record<string, number> = { Makanan: 0, Minuman: 0, Snack: 0, Lainnya: 0 };

  history.forEach((trx) => {
    if (trx.status !== "paid") return;
    const tDate = new Date(trx.created_at);
    if (tDate < start || tDate > end) return;
    const amt = trx.total_amount || 0;
    omzet += amt;
    trxCount += 1;

    let trxHpp = 0;
    trx.transaction_items?.forEach((item: any) => {
      trxHpp += (item.product_variants?.hpp || 0) * item.quantity;
      const pname = item.product_variants?.products?.name || "";
      const vname = item.product_variants?.variant_name || "";
      const cat = inferSaleCategory(pname, vname);
      const sub = (item.unit_price ?? item.product_variants?.price ?? 0) * item.quantity;
      categoryRevenue[cat] = (categoryRevenue[cat] || 0) + sub;
    });
    hpp += trxHpp;

    const pm = (trx.payment_method || "Tunai").toLowerCase();
    if (pm.includes("qris")) payMethodMap.QRIS += amt;
    else if (pm.includes("transfer")) payMethodMap.Transfer += amt;
    else if (pm.includes("tunai") || pm.includes("cash") || !trx.payment_method) payMethodMap.Tunai += amt;
    else payMethodMap.Lainnya += amt;

    hourMap[tDate.getHours()] += 1;

    trx.transaction_items?.forEach((item: any) => {
      const name = item.product_variants?.variant_name || item.product_variants?.products?.name || "Unknown";
      sellerMap[name] = (sellerMap[name] || 0) + item.quantity;
    });
  });

  let expense = 0;
  expenses.forEach((exp) => {
    const eDate = new Date(exp.created_at);
    if (eDate >= start && eDate <= end) expense += exp.amount || 0;
  });

  const netProfit = omzet - hpp - expense;
  const aov = trxCount > 0 ? omzet / trxCount : 0;

  return { omzet, hpp, expense, netProfit, trxCount, aov, payMethodMap, hourMap, sellerMap, categoryRevenue };
}

function buildTrendChartData(history: any[], start: Date, end: Date): { name: string; total: number }[] {
  const msPerDay = 86400000;
  const nDays = Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
  const points: { name: string; total: number }[] = [];
  if (nDays <= 45) {
    const cur = startOfDay(new Date(start));
    const endDay = startOfDay(new Date(end));
    while (cur <= endDay) {
      const label = cur.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
      let total = 0;
      history.forEach((trx) => {
        if (trx.status !== "paid") return;
        const td = startOfDay(new Date(trx.created_at));
        if (td.getTime() === cur.getTime()) total += trx.total_amount || 0;
      });
      points.push({ name: label, total });
      cur.setDate(cur.getDate() + 1);
    }
    return points;
  }
  let cur = startOfDay(new Date(start));
  const endT = end.getTime();
  while (cur.getTime() <= endT) {
    const weekEnd = new Date(cur);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    if (weekEnd.getTime() > endT) weekEnd.setTime(endT);
    const label = `Mgg ${cur.getDate()}/${cur.getMonth() + 1}`;
    let total = 0;
    history.forEach((trx) => {
      if (trx.status !== "paid") return;
      const t = new Date(trx.created_at).getTime();
      if (t >= cur.getTime() && t <= weekEnd.getTime()) total += trx.total_amount || 0;
    });
    points.push({ name: label, total });
    cur.setDate(cur.getDate() + 7);
  }
  return points;
}

type Tab = "transactions" | "tables" | "inventory" | "expenses" | "history" | "analytics" | "settings";
type Role = "kasir" | "owner";

export default function AdminDashboard() {
  const [mounted, setMounted] = useState(false);
  const [authRole, setAuthRole] = useState<Role | null>(null);
  const [pinInput, setPinInput] = useState("");

  const [activeTab, setActiveTab] = useState<Tab>("transactions");
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loadingTrx, setLoadingTrx] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);

  // Expenses State
  const [expenses, setExpenses] = useState<any[]>([]);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState<number | "">(0);
  const [expenseCategory, setExpenseCategory] = useState("Kulakan");
  const [editingExpense, setEditingExpense] = useState<any | null>(null);

  const [viewingTrx, setViewingTrx] = useState<any | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [receiptMode, setReceiptMode] = useState<"bill" | "receipt">("bill");
  const [paymentMethod, setPaymentMethod] = useState("Tunai");

  const [inventory, setInventory] = useState<any[]>([]);
  const [manualBarcode, setManualBarcode] = useState("");
  const [scanMode, setScanMode] = useState(false);

  const scannerRef = useRef<any>(null);

  const handleBatalScan = async () => {
    if (scannerRef.current) await scannerRef.current.stopScanner();
    setScanMode(false);
  };
  const [loadingInv, setLoadingInv] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<any>(null);
  const [addStockAmount, setAddStockAmount] = useState<number | "">("");

  const [isNewProduct, setIsNewProduct] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductPrice, setNewProductPrice] = useState<number | "">("");
  const [newProductHpp, setNewProductHpp] = useState<number | "">("");
  const [newProductStock, setNewProductStock] = useState<number | "">("");
  const [newProductImage, setNewProductImage] = useState("");
  const [newProductCategory, setNewProductCategory] = useState<string>("Makanan");
  const [isRegistering, setIsRegistering] = useState(false);

  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [editProductName, setEditProductName] = useState("");
  const [editProductPrice, setEditProductPrice] = useState<number | "">("");
  const [editProductHpp, setEditProductHpp] = useState<number | "">("");
  const [editProductStock, setEditProductStock] = useState<number | "">("");
  const [editProductBarcode, setEditProductBarcode] = useState("");
  const [editProductImage, setEditProductImage] = useState("");
  const [editProductCategory, setEditProductCategory] = useState<string>("Lainnya");
  const [isUpdatingProduct, setIsUpdatingProduct] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Google Sheets Sync
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);

  // Sync Reminders & Settings
  const [syncReminder, setSyncReminder] = useState<string | null>(null);
  const [remindMidday, setRemindMidday] = useState(12);
  const [remindEvening, setRemindEvening] = useState(17);
  const [remindClosing, setRemindClosing] = useState(22);

  useEffect(() => {
    const saved = localStorage.getItem("pos_sync_settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.midday) setRemindMidday(parsed.midday);
        if (parsed.evening) setRemindEvening(parsed.evening);
        if (parsed.closing) setRemindClosing(parsed.closing);
      } catch (e) { console.error("Error loading sync settings", e); }
    }
  }, []);

  const saveSyncSettings = (mid: number, eve: number, clo: number) => {
    setRemindMidday(mid); setRemindEvening(eve); setRemindClosing(clo);
    localStorage.setItem("pos_sync_settings", JSON.stringify({ midday: mid, evening: eve, closing: clo }));
  };

  useEffect(() => {
    const checkSyncTime = () => {
      const now = new Date();
      const hour = now.getHours();
      const mins = now.getMinutes();

      const hoursToRemind = [remindMidday, remindEvening, remindClosing];
      
      let currentMsg = null;
      for (const h of hoursToRemind) {
        // Small Warning (Persiapan): 10 minutes before the hour
        if (hour === h - 1 && mins >= 50) {
          const type = h === remindClosing ? "Tutup Toko" : h === remindMidday ? "Siang" : "Sore";
          currentMsg = `📢 Persiapan: 10 menit lagi masuk jam sinkronisasi ${type} (${h}:00)`;
          break;
        }
        // Main Warning: first 15 mins of the hour
        if (hour === h && mins < 15) {
          const type = h === remindClosing ? "Tutup Toko 🌙" : h === remindMidday ? "Siang 🕒" : "Sore 🌆";
          currentMsg = `⚠️ Waktunya Sinkronisasi ${type}! Silakan tekan tombol Sync Google Sheets.`;
          break;
        }
      }
      setSyncReminder(currentMsg);
    };

    checkSyncTime();
    const interval = setInterval(checkSyncTime, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [remindMidday, remindEvening, remindClosing]);

  // Inventory period filter
  const [invPeriod, setInvPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('today');
  const [invCustomFrom, setInvCustomFrom] = useState('');
  const [invCustomTo, setInvCustomTo] = useState('');

  // History period filter
  const [histPeriod, setHistPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('today');
  const [histCustomFrom, setHistCustomFrom] = useState('');
  const [histCustomTo, setHistCustomTo] = useState('');

  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>('thisMonth');
  const [analyticsCustomFrom, setAnalyticsCustomFrom] = useState('');
  const [analyticsCustomTo, setAnalyticsCustomTo] = useState('');

  // Tables / Locations State
  const [tablesList, setTablesList] = useState<string[]>([]);
  // Table occupancy tracking: 'occupied' | 'confirmed' | 'left'
  const [tableOccupancy, setTableOccupancy] = useState<Record<string, string>>({});

  useBarcodeScanner((barcode) => {
    if (activeTab === 'inventory' && authRole === 'owner') {
      if (!isNewProduct && !editingProduct) {
        if (scanMode) handleBatalScan();
        findInventory(barcode);
      }
    }
  });

  useEffect(() => {
    setMounted(true);
    const savedRole = localStorage.getItem("pos_admin_role") as Role | null;
    const savedTables = localStorage.getItem("pos_admin_tables");

    if (savedTables) {
      setTablesList(JSON.parse(savedTables));
    } else {
      setTablesList(Array.from({ length: 10 }, (_, i) => (i + 1).toString()));
    }

    const savedOcc = localStorage.getItem('pos_table_occ');
    if (savedOcc) setTableOccupancy(JSON.parse(savedOcc));

    if (savedRole) {
      setAuthRole(savedRole);
      // loadData is handled by the authRole effect below
    }
  }, []);

  // Supabase Realtime Listener
  useEffect(() => {
    let channel: any = null;
    if (authRole) {
      loadData();

      channel = supabase.channel('realtime_pos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
          fetchTransactions();
          fetchHistory();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'product_variants' }, () => {
          fetchInventory();
        })
        .subscribe();
    }
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [authRole]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === "admin1234keluargakedai") {
      setAuthRole("kasir"); localStorage.setItem("pos_admin_role", "kasir");
    } else if (pinInput === "ownerkedaikeluarga8888") {
      setAuthRole("owner"); localStorage.setItem("pos_admin_role", "owner");
    } else {
      alert("Password Salah!");
      setPinInput("");
    }
  };

  const loadData = () => {
    fetchTransactions();
    fetchInventory();
    fetchHistory();
    fetchExpenses();
  };

  const logActivity = async (actionDesc: string) => {
    try {
      if (!authRole) return;
      await supabase.from("activity_logs").insert([{ role: authRole.toUpperCase(), action: actionDesc }]);
    } catch (err) { console.error("Logger err", err); }
  };

  const fetchTransactions = async () => {
    setLoadingTrx(true);
    const { data } = await supabase.from("transactions").select("*, transaction_items(*, product_variants(*, products(name)))").eq("status", "pending").order("created_at", { ascending: true });
    if (data) setTransactions(data);
    setLoadingTrx(false);
  };

  const fetchHistory = async () => {
    setLoadingHist(true);
    const { data } = await supabase.from("transactions").select("*, transaction_items(*, product_variants(*, products(name)))").in("status", ["paid", "cancelled"]).order("created_at", { ascending: false }).limit(500);
    if (data) setHistory(data);
    setLoadingHist(false);
  };

  const fetchExpenses = async () => {
    const { data } = await supabase.from("expenses").select("*").order("created_at", { ascending: false }).limit(200);
    if (data) setExpenses(data);
  };

  const handleAddExpense = async () => {
    if (!expenseDesc || !expenseAmount || expenseAmount <= 0) { alert("Isi deskripsi dan jumlah!"); return; }
    
    if (editingExpense) {
      // UPDATE existing
      const { error } = await supabase.from("expenses").update({ 
        description: expenseDesc, 
        amount: Number(expenseAmount), 
        category: expenseCategory 
      }).eq("id", editingExpense.id);
      
      if (error) { alert("Gagal mengubah data! Error: " + error.message); return; }
      logActivity(`Ubah Pengeluaran: ${expenseCategory} - ${expenseDesc} Rp ${expenseAmount}`);
    } else {
      // INSERT new
      const { error } = await supabase.from("expenses").insert([{ 
        description: expenseDesc, 
        amount: Number(expenseAmount), 
        category: expenseCategory 
      }]);
      
      if (error) { alert("Gagal menyimpan. Pastikan tabel 'expenses' sudah dibuat! Error: " + error.message); return; }
      logActivity(`Catat Pengeluaran: ${expenseCategory} - ${expenseDesc} Rp ${expenseAmount}`);
    }

    setExpenseDesc(""); setExpenseAmount(0); setShowExpenseForm(false); setEditingExpense(null);
    fetchExpenses();
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm("Hapus catatan pengeluaran ini?")) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) { alert("Gagal menghapus! " + error.message); return; }
    logActivity(`Hapus Pengeluaran ID ${id.substring(0, 8)}`);
    fetchExpenses();
  };

  const handleOpenEditExpense = (exp: any) => {
    setEditingExpense(exp);
    setExpenseDesc(exp.description);
    setExpenseAmount(exp.amount);
    setExpenseCategory(exp.category);
    setShowExpenseForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll to form
  };

  const fetchInventory = async () => {
    setLoadingInv(true);
    const { data } = await supabase.from("product_variants").select("*, products(name)").order("id", { ascending: false });
    if (data) setInventory(data);
    setLoadingInv(false);
  };

  const handleProcessPayment = async () => {
    if (!viewingTrx || viewingTrx.status !== 'pending') return;
    const { error } = await supabase.from("transactions").update({ status: "paid", payment_method: paymentMethod }).eq("id", viewingTrx.id);
    if (!error) {
      logActivity(`Transaksi ${viewingTrx.id.substring(0, 8)} diproses via ${paymentMethod} (Rp ${viewingTrx.total_amount})`);

      // Update Sold Count + Reduce Stock
      for (const item of viewingTrx.transaction_items) {
        if (item.variant_id) {
          const variant = inventory.find(i => i.id === item.variant_id);
          if (variant) {
            const newSoldCount = (variant.sold_count || 0) + item.quantity;
            const newStock = Math.max(0, (variant.stock || 0) - item.quantity);
            await supabase.from("product_variants").update({ sold_count: newSoldCount, stock: newStock }).eq("id", variant.id);
          }
        }
      }

      if (viewingTrx.table_number) {
        setTableOccupancy(p => {
          const n = { ...p, [viewingTrx.table_number]: 'confirmed' };
          localStorage.setItem('pos_table_occ', JSON.stringify(n));
          return n;
        });
      }

      setViewingTrx({ ...viewingTrx, status: "paid" });
      alert("✅ Pembayaran sukses!");
      loadData();
    } else alert("❌ Error: " + error.message);
  };

  const handleCancelOrder = async () => {
    setShowCancelConfirm(false);
    if (!viewingTrx || viewingTrx.status !== 'pending') return;

    const { error } = await supabase.from("transactions").update({ status: "cancelled" }).eq("id", viewingTrx.id);
    if (!error) {
      logActivity(`Transaksi ${viewingTrx.id.substring(0, 8)} DIBATALKAN (Void)`);
      alert("Pesanan dibatalkan (VOID).");
      setViewingTrx(null); loadData();
    } else alert("Error: " + error.message);
  };

  const handleDeleteTrx = async () => {
    setShowDeleteConfirm(false);
    if (!viewingTrx) return;

    // If this was a paid transaction, restore stock & sold_count
    if (viewingTrx.status === 'paid') {
      for (const item of (viewingTrx.transaction_items || [])) {
        if (item.variant_id) {
          const variant = inventory.find(i => i.id === item.variant_id);
          if (variant) {
            const restoredStock = (variant.stock || 0) + item.quantity;
            const restoredSold = Math.max(0, (variant.sold_count || 0) - item.quantity);
            await supabase.from("product_variants").update({ stock: restoredStock, sold_count: restoredSold }).eq("id", variant.id);
          }
        }
      }
    }

    const { error } = await supabase.from("transactions").delete().eq("id", viewingTrx.id);
    if (!error) {
      logActivity(`Transaksi ${viewingTrx.id.substring(0, 8)} DIHAPUS PERMANEN (stok dikembalikan)`);
      setViewingTrx(null); loadData();
    } else alert("Error: " + error.message);
  };

  const findInventory = (barcode: string) => {
    const cleanBarcode = barcode?.toString().trim();
    if (!cleanBarcode) return;
    const item = inventory.find(i => i.barcode?.toString().trim() === cleanBarcode);
    if (item) { setSelectedVariant(item); setIsNewProduct(false); }
    else {
      setSelectedVariant(null); setIsNewProduct(true);
      setManualBarcode(cleanBarcode); setNewProductName(""); setNewProductPrice(""); setNewProductHpp(""); setNewProductStock(""); setNewProductImage("");
    }
  };

  const handleScanInventory = async (barcode: string) => {
    await handleBatalScan();
    findInventory(barcode);
  };

  const handleRegisterProduct = async () => {
    setIsRegistering(true);
    try {
      const { data: prodData, error: prodErr } = await supabase.from("products").insert([{ name: newProductName }]).select().single();
      if (prodErr) throw new Error(prodErr.message);
      const { error: variantErr } = await supabase.from("product_variants").insert([{
        product_id: prodData.id, barcode: manualBarcode, price: Number(newProductPrice), stock: Number(newProductStock), hpp: Number(newProductHpp), variant_name: newProductName, image_url: newProductImage, category: newProductCategory
      }]);
      if (variantErr) throw new Error(variantErr.message);

      logActivity(`Menambah Produk Baru: ${newProductName} (Stok: ${newProductStock})`);
      setIsNewProduct(false); fetchInventory();
    } catch (err: any) { alert("Error: " + (err.message)); } finally { setIsRegistering(false); }
  };

  const handleAddStock = async () => {
    const newStock = (selectedVariant.stock || 0) + Number(addStockAmount);
    const { error } = await supabase.from("product_variants").update({ stock: newStock }).eq("id", selectedVariant.id);
    if (!error) {
      logActivity(`Tambah Stok ${selectedVariant.variant_name} sebanyak +${addStockAmount}`);
      setSelectedVariant(null); setAddStockAmount(""); fetchInventory();
    } else alert("Error: " + error.message);
  };

  const openEditProduct = (item: any) => {
    setEditingProduct(item);
    setEditProductName(item.products?.name || item.variant_name || item.name || "");
    setEditProductPrice(item.price || 0);
    setEditProductHpp(item.hpp || 0);
    setEditProductStock(item.stock || 0);
    setEditProductBarcode(item.barcode || "");
    setEditProductImage(item.image_url || "");
    setEditProductCategory(item.category || "Lainnya");
  };

  const handleUpdateProduct = async () => {
    setIsUpdatingProduct(true);
    try {
      if (editingProduct.product_id) await supabase.from("products").update({ name: editProductName }).eq("id", editingProduct.product_id);
      const { error } = await supabase.from("product_variants").update({
        variant_name: editProductName, price: Number(editProductPrice), stock: Number(editProductStock), hpp: Number(editProductHpp), barcode: editProductBarcode, image_url: editProductImage, category: editProductCategory
      }).eq("id", editingProduct.id);

      if (error) throw error;
      logActivity(`Update Produk ${editProductName}`);
      setEditingProduct(null); fetchInventory();
    } catch (err: any) { alert("Error: " + err.message); } finally { setIsUpdatingProduct(false); }
  };

  const handleDeleteProduct = async () => {
    if (!confirm(`YAKIN HAPUS PERMANEN "${editProductName}"?`)) return;
    setIsUpdatingProduct(true);
    try {
      const { error } = await supabase.from("product_variants").delete().eq("id", editingProduct.id);
      if (error) throw error;
      logActivity(`Hapus Permanen Produk: ${editProductName}`);
      setEditingProduct(null); fetchInventory();
    } catch (err: any) { alert("Error: " + err.message); } finally { setIsUpdatingProduct(false); }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, setter: (url: string) => void) => {
    try {
      if (!e.target.files || e.target.files.length === 0) return;
      const file = e.target.files[0];
      
      // Validasi tipe file
      if (!file.type.startsWith('image/')) {
        alert("Hanya file gambar yang diizinkan!");
        return;
      }

      setIsUploading(true);
      console.log("Memulai upload ke Supabase Storage (bucket: product-images)...");

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `products/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error("Upload Error detail:", uploadError);
        throw uploadError;
      }

      console.log("Upload berhasil:", uploadData);

      const { data } = supabase.storage.from('product-images').getPublicUrl(filePath);
      setter(data.publicUrl);
      console.log("Public URL didapat:", data.publicUrl);

    } catch (err: any) {
      console.error("Kesalahan lengkap saat upload:", err);
      alert("Gagal upload! Pastikan Anda sudah membuat bucket bernama 'product-images' dan mengeset RLS Policy ke Public di Supabase! Error: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handlePrintPDF = () => {
    const printContent = document.getElementById("printable-receipt");
    if (!printContent) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed'; iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`<html><head><title>Struk Pembayaran</title><style>@page { margin: 0; } body { font-family: monospace; padding: 20px; color: black; font-size: 12px; } .text-center { text-align: center; } .font-bold { font-weight: bold; } .mb-1 { margin-bottom: 4px; } .mb-3 { margin-bottom: 12px; } .mb-5 { margin-bottom: 20px; } .flex { display: flex; } .justify-between { justify-content: space-between; } .border-b-2 { border-bottom: 1px dashed black; margin-bottom: 8px;} .uppercase { text-transform: uppercase; } .text-sm { font-size: 14px; } .text-lg { font-size: 18px; } .italic { font-style: italic; } .opacity-80 { opacity: 0.8; } .pt-2 { padding-top: 8px; border-top: 2px solid black; }</style></head><body>${printContent.innerHTML}</body></html>`);
      doc.close();
      setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); setTimeout(() => document.body.removeChild(iframe), 1000); }, 200);
    }
  };

  const handlePrintBluetooth = async () => {
    if (!viewingTrx) return;
    let pt = "\x1B\x40\x1B\x61\x01Kedai Keluarga\n--------------------------------\n\x1B\x61\x00";
    pt += `No: ${viewingTrx.id.substring(0, 8).toUpperCase()}\nTgl: ${new Date().toLocaleString('id-ID')}\nPlg: ${viewingTrx.customer_name || '-'}\nMeja: ${viewingTrx.table_number || '-'}\n--------------------------------\n`;
    viewingTrx.transaction_items.forEach((item: any) => {
      const name = item.product_variants?.variant_name || item.product_variants?.products?.name || "Item";
      pt += `${name.substring(0, 32)}\n`;
      const qty = `${item.quantity}x ${item.unit_price || item.price || 0}`;
      const sub = ((item.unit_price || item.price || 0) * item.quantity).toString();
      pt += `${qty}${" ".repeat(Math.max(1, 32 - qty.length - sub.length))}${sub}\n`;
    });
    pt += `--------------------------------\nTOTAL:${" ".repeat(Math.max(1, 26 - viewingTrx.total_amount.toString().length))}${viewingTrx.total_amount}\n--------------------------------\n\x1B\x61\x01TERIMA KASIH\n\n\n\n`;
    try {
      const nav = navigator as any;
      const device = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'] });
      const server = await device.gatt.connect();
      const service = (await server.getPrimaryServices())[0];
      const char = (await service.getCharacteristics()).find((c: any) => c.properties.write || c.properties.writeWithoutResponse);
      const data = new TextEncoder().encode(pt);
      for (let i = 0; i < data.length; i += 512) await char.writeValue(data.slice(i, i + 512));
    } catch (err: any) { if (err.name !== 'NotFoundError') alert("❌ BT Error: " + err.message); }
  };

  const analyticsData = useMemo(() => {
    const { start, end, label: rangeLabel } = getAnalyticsRange(analyticsPeriod, analyticsCustomFrom, analyticsCustomTo);
    const { start: pStart, end: pEnd } = previousEqualPeriod(start, end);

    const curr = aggregatePeriodMetrics(history, expenses, start, end);
    const prev = aggregatePeriodMetrics(history, expenses, pStart, pEnd);

    const msPerDay = 86400000;
    const nDays = Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
    const trendGranularity = nDays <= 45 ? "Harian" : "Mingguan (agregat)";

    const chartElements = buildTrendChartData(history, start, end);
    const payMethodChart = Object.entries(curr.payMethodMap)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
    const rushHourChart = Object.entries(curr.hourMap)
      .filter(([, v]) => v > 0)
      .map(([h, count]) => ({ name: `${h}:00`, count }));
    const bestSellerChart = Object.entries(curr.sellerMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, sold]) => ({ name: name.substring(0, 15), sold }));

    const categoryChart = Object.entries(curr.categoryRevenue)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));

    const variantSold: Record<string, number> = {};
    history.forEach((trx) => {
      if (trx.status !== "paid") return;
      const tDate = new Date(trx.created_at);
      if (tDate < start || tDate > end) return;
      trx.transaction_items?.forEach((item: any) => {
        if (item.variant_id) {
          variantSold[item.variant_id] = (variantSold[item.variant_id] || 0) + item.quantity;
        }
      });
    });

    const worstSellerChart = [...inventory]
      .map((inv: any) => ({
        name: (inv.variant_name || inv.products?.name || "?").substring(0, 18),
        sold: variantSold[inv.id] || 0,
      }))
      .sort((a, b) => a.sold - b.sold)
      .slice(0, 8);

    const lowStockItems = [...inventory]
      .sort((a: any, b: any) => (a.stock ?? 0) - (b.stock ?? 0))
      .slice(0, 5)
      .map((i: any) => ({
        id: i.id,
        name: (i.variant_name || i.products?.name || "?").substring(0, 28),
        stock: i.stock ?? 0,
        barcode: i.barcode || "",
      }));

    return {
      rangeLabel,
      trendGranularity,
      omzet: curr.omzet,
      hpp: curr.hpp,
      expense: curr.expense,
      netProfit: curr.netProfit,
      trxCount: curr.trxCount,
      aov: curr.aov,
      prevOmzet: prev.omzet,
      prevHpp: prev.hpp,
      prevExpense: prev.expense,
      prevNet: prev.netProfit,
      prevAov: prev.aov,
      growthOmzet: growthPct(curr.omzet, prev.omzet),
      growthHpp: growthPct(curr.hpp, prev.hpp),
      growthExpense: growthPct(curr.expense, prev.expense),
      growthNet: growthPct(curr.netProfit, prev.netProfit),
      growthAov: growthPct(curr.aov, prev.aov),
      chartElements,
      payMethodChart,
      rushHourChart,
      bestSellerChart,
      worstSellerChart,
      categoryChart,
      lowStockItems,
    };
  }, [history, expenses, inventory, analyticsPeriod, analyticsCustomFrom, analyticsCustomTo]);

  const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

  const formatGrowthLine = (pct: number | null) => {
    if (pct === null) {
      return <p className="text-[10px] text-gray-400 mt-1 font-medium">Tanpa pembanding (periode lalu Rp 0)</p>;
    }
    const up = pct >= 0;
    return (
      <p className={`text-[10px] mt-1 font-bold flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-red-600"}`}>
        {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
        {up ? "+" : ""}
        {pct.toFixed(1)}% vs periode sebelumnya
      </p>
    );
  };

  // Compute sold per variant from history, filtered by period
  const inventorySoldMap = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const getStartOfWeek = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay() + 1); x.setHours(0, 0, 0, 0); return x; };
    const getStartOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
    const getStartOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);

    const map: Record<string, number> = {};
    history.forEach(trx => {
      if (trx.status !== 'paid') return;
      const tDate = new Date(trx.created_at);

      let inRange = false;
      if (invPeriod === 'today') inRange = tDate.toDateString() === todayStr;
      else if (invPeriod === 'week') inRange = tDate >= getStartOfWeek(now);
      else if (invPeriod === 'month') inRange = tDate >= getStartOfMonth(now);
      else if (invPeriod === 'year') inRange = tDate >= getStartOfYear(now);
      else if (invPeriod === 'custom') {
        const from = invCustomFrom ? new Date(invCustomFrom) : new Date(0);
        const to = invCustomTo ? new Date(invCustomTo + 'T23:59:59') : new Date();
        inRange = tDate >= from && tDate <= to;
      }
      if (!inRange) return;

      trx.transaction_items?.forEach((item: any) => {
        if (item.variant_id) {
          map[item.variant_id] = (map[item.variant_id] || 0) + item.quantity;
        }
      });
    });
    return map;
  }, [history, invPeriod, invCustomFrom, invCustomTo]);

  // Filtered history by period
  const filteredHistory = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const getStartOfWeek = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay() + 1); x.setHours(0, 0, 0, 0); return x; };
    const getStartOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
    const getStartOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);

    return history.filter(trx => {
      const tDate = new Date(trx.created_at);
      if (histPeriod === 'today') return tDate.toDateString() === todayStr;
      if (histPeriod === 'week') return tDate >= getStartOfWeek(now);
      if (histPeriod === 'month') return tDate >= getStartOfMonth(now);
      if (histPeriod === 'year') return tDate >= getStartOfYear(now);
      if (histPeriod === 'custom') {
        const from = histCustomFrom ? new Date(histCustomFrom) : new Date(0);
        const to = histCustomTo ? new Date(histCustomTo + 'T23:59:59') : new Date();
        return tDate >= from && tDate <= to;
      }
      return true;
    });
  }, [history, histPeriod, histCustomFrom, histCustomTo]);

  // Filtered inventory based on search term
  const filteredInventory = useMemo(() => {
    const term = manualBarcode?.toLowerCase().trim() || "";
    if (!term) return inventory;
    return inventory.filter(item => {
      const barcode = item.barcode?.toString().toLowerCase() || "";
      const name = (item.variant_name || item.products?.name || "").toLowerCase();
      return barcode.includes(term) || name.includes(term);
    });
  }, [inventory, manualBarcode]);

  if (!mounted) return null;

  if (!authRole) {
    return (
      <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full animate-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4"><Lock size={32} className="text-blue-600" /></div>
          <h2 className="text-2xl font-black text-center text-slate-800 mb-2">POS Login</h2>
          <p className="text-center text-gray-500 mb-6 text-sm">Masukkan PIN Kasir atau PIN Owner.</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="Masukkan Password" className="w-full text-center text-lg bg-gray-50 border border-gray-200 rounded-2xl px-4 py-4 focus:ring-4 focus:ring-blue-500 outline-none transition-all font-mono text-slate-900" autoFocus />
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg active:scale-95 text-lg">Masuk</button>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col font-sans mb-10">
      <div className="bg-slate-900 text-white p-5 shadow-lg sticky top-0 z-10 border-b border-slate-800 flex justify-between items-center no-print">
        <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
          <ShoppingBag size={22} /> KEDAI KELUARGA <span className="text-[10px] bg-blue-600 px-2 py-1 rounded ml-2 uppercase font-mono">{authRole}</span>
        </h1>
        <button onClick={() => { setAuthRole(null); localStorage.removeItem("pos_admin_role"); window.location.href = '/'; }} className="text-xs bg-slate-800 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-lg transition-colors font-bold flex items-center gap-1.5 shadow-sm"><Lock size={14} /> Ganti Role</button>
      </div>

      {/* Tabs */}
      <div className="flex bg-white shadow-sm border-b border-gray-200 no-print overflow-x-auto pb-1 text-sm sm:text-base font-medium scrollbar-hide">
        <button className={`px-4 sm:flex-1 py-4 transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'transactions' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 font-bold' : 'text-gray-500'}`} onClick={() => setActiveTab('transactions')}><ListOrdered size={18} /> Antrean  {transactions.length > 0 && <span className="bg-red-500 text-white px-2 py-0.5 rounded-full text-xs">{transactions.length}</span>}</button>
        <button className={`px-4 sm:flex-1 py-4 transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'tables' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 font-bold' : 'text-gray-500'}`} onClick={() => setActiveTab('tables')}><LayoutGrid size={18} /> Denah Meja</button>
        {authRole === 'owner' && <button className={`px-4 sm:flex-1 py-4 transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'inventory' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 font-bold' : 'text-gray-500'}`} onClick={() => setActiveTab('inventory')}><PackageSearch size={18} /> Inventori</button>}
        
        {/* NEW TAB: EXPENSES */}
        {authRole === 'owner' && <button className={`px-4 sm:flex-1 py-4 transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'expenses' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 font-bold' : 'text-gray-500'}`} onClick={() => setActiveTab('expenses')}><Receipt size={18} /> Pengeluaran</button>}
        
        <button className={`px-4 sm:flex-1 py-4 transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'history' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 font-bold' : 'text-gray-500'}`} onClick={() => setActiveTab('history')}><History size={18} /> Riwayat</button>
        {authRole === 'owner' && <button className={`px-4 sm:flex-1 py-4 transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'analytics' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 font-bold' : 'text-gray-500'}`} onClick={() => setActiveTab('analytics')}><BarChart3 size={18} /> Analytics</button>}
        
        {/* NEW TAB: SETTINGS */}
        {authRole === 'owner' && <button className={`px-4 sm:flex-1 py-4 transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'settings' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 font-bold' : 'text-gray-500'}`} onClick={() => setActiveTab('settings')}><Settings size={18} /> Settings</button>}
        
        <button className="px-4 py-4 text-slate-500 hover:text-blue-600 transition-colors ml-auto sm:ml-0" onClick={loadData} title="Sinkronkan Data Manual"><RotateCcw size={18} /></button>
      </div>

      {/* Sync Reminder Banner */}
      {syncReminder && authRole === 'owner' && (
        <div className="bg-amber-500 text-white p-3 text-center text-sm font-bold animate-pulse flex items-center justify-center gap-2 no-print">
          <AlertCircle size={18} /> {syncReminder}
          <button onClick={() => setActiveTab('analytics')} className="bg-white text-amber-600 px-3 py-1 rounded-lg text-[10px] ml-2 hover:bg-amber-50 transition-colors uppercase">Buka Sync</button>
        </div>
      )}

      <div className="p-4 max-w-5xl w-full mx-auto flex-1 no-print">

        {/* ================= TAB PENDING TRANSACTIONS ================= */}
        {activeTab === "transactions" && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {loadingTrx ? <div className="text-center py-10 opacity-50"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div> : transactions.length === 0 ? (
              <div className="text-center bg-white p-10 rounded-2xl border border-dashed border-gray-300"><CheckCircle size={40} className="mx-auto text-green-500 mb-2 opacity-50" /><p className="text-gray-500 font-medium">Belum ada antrean baru!</p></div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {transactions.map(trx => (
                  <div key={trx.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-4 border-b border-gray-100 pb-3">
                      <div>
                        <p className="font-black text-slate-800 text-lg mb-0.5 truncate uppercase">{trx.customer_name || "TANPA NAMA"}</p>
                        <p className="text-xs text-slate-500 font-bold mb-2">Meja: <span className="text-blue-600 bg-blue-50 px-1 py-0.5 rounded">{trx.table_number || "Takeaway"}</span></p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-400 font-bold uppercase">Total</p>
                        <p className="text-lg font-black text-blue-600">{(trx.total_amount / 1000)}k</p>
                      </div>
                    </div>
                    <button onClick={() => { setViewingTrx(trx); setReceiptMode('bill'); }} className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:-translate-y-0.5 transition-transform text-sm">Proses & Bayar</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB TABLE MAP ================= */}
        {activeTab === "tables" && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><LayoutGrid size={20} /> Denah Lokasi / Meja</h2>
              <button
                onClick={() => {
                  const input = prompt("Masukkan daftar nama/nomor meja (pisahkan dengan koma):", tablesList.join(", "));
                  if (input !== null && input.trim()) {
                    const newTables = input.split(",").map(t => t.trim()).filter(Boolean);
                    if (newTables.length > 0) {
                      setTablesList(newTables);
                      localStorage.setItem("pos_admin_tables", JSON.stringify(newTables));
                      logActivity("Mengubah Daftar Lokasi Meja: " + newTables.length + " meja");
                    }
                  }
                }}
                className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors flex items-center gap-1.5"
              >
                <Edit size={14} /> Edit Meja
              </button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-8 gap-3">
              {tablesList.map((tableStr, i) => {
                const trxs = transactions.filter(t => t.table_number === tableStr);
                const hasPending = trxs.length > 0;
                const occ = tableOccupancy[tableStr] || '';
                // Colors: pending+no status = yellow, confirmed = red (occupied), left = orange, empty = gray
                let bgClass = 'bg-white border-gray-200 text-gray-400 opacity-70';
                let statusLabel = 'Kosong';
                if (hasPending && !occ) { bgClass = 'bg-yellow-50 border-yellow-400 text-yellow-700 shadow-md'; statusLabel = 'Ada Pesanan'; }
                else if (occ === 'confirmed') { bgClass = 'bg-green-50 border-green-500 text-green-700 shadow-md scale-105 z-10'; statusLabel = 'Masih Ada'; }
                else if (occ === 'left') { bgClass = 'bg-orange-50 border-orange-400 text-orange-600 shadow-md'; statusLabel = 'Sudah Pergi'; }
                else if (hasPending) { bgClass = 'bg-yellow-50 border-yellow-400 text-yellow-700 shadow-md'; statusLabel = 'Ada Pesanan'; }

                return (
                  <div
                    key={i}
                    className={`rounded-2xl flex flex-col items-center justify-center border-2 transition-all p-2 text-center overflow-hidden ${bgClass} ${(hasPending || occ) ? 'cursor-pointer hover:brightness-95' : ''}`}
                  >
                    <p className="text-lg font-black w-full truncate leading-none">{tableStr}</p>
                    <p className="text-[8px] font-bold uppercase mt-1 leading-none">{statusLabel}</p>
                    {(hasPending || occ) && (
                      <div className="flex flex-col gap-1 mt-2 w-full">
                        {hasPending && <button onClick={() => setViewingTrx(trxs[0])} className="text-[8px] bg-white/80 hover:bg-white rounded-lg py-1 font-bold border border-gray-200 transition-all">Lihat</button>}
                        {occ !== 'confirmed' && (hasPending || occ) && <button onClick={() => { setTableOccupancy(p => { const n = { ...p, [tableStr]: 'confirmed' }; localStorage.setItem('pos_table_occ', JSON.stringify(n)); return n; }); }} className="text-[8px] bg-green-500 text-white rounded-lg py-1 font-bold">✅ Masih Ada</button>}
                        {occ === 'confirmed' && <button onClick={() => { setTableOccupancy(p => { const n = { ...p, [tableStr]: 'left' }; localStorage.setItem('pos_table_occ', JSON.stringify(n)); return n; }); }} className="text-[8px] bg-orange-500 text-white rounded-lg py-1 font-bold">🚶 Sudah Pergi</button>}
                        {(occ === 'left' || occ === 'confirmed') && <button onClick={() => { setTableOccupancy(p => { const n = { ...p }; delete n[tableStr]; localStorage.setItem('pos_table_occ', JSON.stringify(n)); return n; }); }} className="text-[8px] bg-gray-400 text-white rounded-lg py-1 font-bold">🧹 Kosongkan</button>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-4">
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500"><span className="w-3 h-3 rounded bg-gray-200 border"></span> Kosong</span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-yellow-600"><span className="w-3 h-3 rounded bg-yellow-300 border border-yellow-400"></span> Ada Pesanan</span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-green-700"><span className="w-3 h-3 rounded bg-green-400 border border-green-500"></span> Masih Ada (Dikonfirmasi)</span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-orange-600"><span className="w-3 h-3 rounded bg-orange-300 border border-orange-400"></span> Sudah Pergi</span>
            </div>

            <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm mt-6 border border-blue-100">
              <p className="font-bold flex items-center gap-2"><CheckCircle size={16} /> Informasi Kustomisasi Meja</p>
              <p className="mt-1 opacity-90">Pemilik maupun Kasir dapat mengubah daftar nama meja kapan saja sesuai *layout* fisik restoran. Meja bisa berisi angka maupun teks seperti "VIP 1", "Teras", dll.</p>
            </div>
          </div>
        )}

        {/* ================= TAB ANALYTICS (FULL DASHBOARD) ================= */}
        {activeTab === "analytics" && authRole === 'owner' && (
          <div className="space-y-6 animate-in fade-in duration-300">

            {/* Filter periode Analytics */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-2 flex items-center gap-2"><CalendarDays size={14} /> Periode laporan</p>
              <p className="text-xs text-slate-600 font-semibold mb-3">{analyticsData.rangeLabel}</p>
              <div className="flex flex-wrap gap-2">
                {([
                  ["today", "Hari Ini"],
                  ["thisWeek", "Minggu Ini"],
                  ["lastWeek", "Minggu Lalu"],
                  ["thisMonth", "Bulan Ini"],
                  ["lastMonth", "Bulan Lalu"],
                  ["thisYear", "Tahun Ini"],
                  ["custom", "Rentang tanggal"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAnalyticsPeriod(key)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${analyticsPeriod === key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-500 border-gray-200 hover:border-blue-300"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {analyticsPeriod === "custom" && (
                <div className="flex flex-wrap gap-2 mt-3 items-center">
                  <input
                    type="date"
                    value={analyticsCustomFrom}
                    onChange={(e) => setAnalyticsCustomFrom(e.target.value)}
                    className="flex-1 min-w-[140px] border border-gray-300 rounded-lg p-2 text-sm text-slate-900"
                  />
                  <span className="text-gray-400 text-sm">s/d</span>
                  <input
                    type="date"
                    value={analyticsCustomTo}
                    onChange={(e) => setAnalyticsCustomTo(e.target.value)}
                    className="flex-1 min-w-[140px] border border-gray-300 rounded-lg p-2 text-sm text-slate-900"
                  />
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-3">
                Semua metrik & grafik di bawah mengikuti periode ini. Pembanding % adalah rentang waktu dengan durasi sama sebelum periode terpilih.
              </p>
            </div>

            {/* Peringatan stok menipis */}
            {analyticsData.lowStockItems.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-amber-900 flex items-center gap-2 mb-3">
                  <AlertCircle size={18} /> Stok menipis — prioritas kulakan
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                  {analyticsData.lowStockItems.map((row) => (
                    <div key={row.id} className="bg-white rounded-xl px-3 py-2 border border-amber-100 shadow-sm">
                      <p className="text-xs font-bold text-slate-800 truncate" title={row.name}>{row.name}</p>
                      <p className="text-[10px] text-gray-500 font-mono truncate">{row.barcode || "—"}</p>
                      <p className={`text-sm font-black mt-1 ${row.stock <= 5 ? "text-red-600" : "text-amber-700"}`}>
                        Sisa: {row.stock} pcs
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ringkasan + pertumbuhan + AOV */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              <div className="bg-white p-4 rounded-2xl shadow-sm border-l-4 border-l-blue-500">
                <p className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><DollarSign size={12} /> Omzet</p>
                <p className="text-lg sm:text-xl font-black text-slate-800 mt-1">Rp {analyticsData.omzet.toLocaleString("id-ID")}</p>
                {formatGrowthLine(analyticsData.growthOmzet)}
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border-l-4 border-l-orange-400">
                <p className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><PackageSearch size={12} /> Modal (HPP)</p>
                <p className="text-lg sm:text-xl font-black text-orange-600 mt-1">Rp {analyticsData.hpp.toLocaleString("id-ID")}</p>
                {formatGrowthLine(analyticsData.growthHpp)}
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border-l-4 border-l-red-400">
                <p className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><Receipt size={12} /> Operasional</p>
                <p className="text-lg sm:text-xl font-black text-red-600 mt-1">Rp {analyticsData.expense.toLocaleString("id-ID")}</p>
                {formatGrowthLine(analyticsData.growthExpense)}
              </div>
              <div className={`bg-white p-4 rounded-2xl shadow-sm border-l-4 ${analyticsData.netProfit >= 0 ? "border-l-green-500" : "border-l-red-500"}`}>
                <p className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><TrendingUp size={12} /> Laba bersih</p>
                <p className={`text-lg sm:text-xl font-black mt-1 ${analyticsData.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>Rp {analyticsData.netProfit.toLocaleString("id-ID")}</p>
                {formatGrowthLine(analyticsData.growthNet)}
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border-l-4 border-l-indigo-500 col-span-2 lg:col-span-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1"><ShoppingCart size={12} /> Rata-rata struk (AOV)</p>
                <p className="text-lg sm:text-xl font-black text-indigo-700 mt-1">Rp {Math.round(analyticsData.aov).toLocaleString("id-ID")}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{analyticsData.trxCount} transaksi lunas</p>
                {formatGrowthLine(analyticsData.growthAov)}
              </div>
            </div>

            {/* GRAFIK TREN PENJUALAN (LINE CHART) */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-sm font-bold text-gray-800 mb-1 uppercase tracking-wider flex items-center gap-2"><TrendingUp size={16} /> Tren penjualan</h3>
              <p className="text-[10px] text-gray-400 mb-4">{analyticsData.rangeLabel} · {analyticsData.trendGranularity}</p>
              <div className="h-56 w-full"><ResponsiveContainer width="100%" height="100%">
                <LineChart data={analyticsData.chartElements}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6b7280' }} dy={10} />
                  <YAxis width={55} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <Tooltip formatter={(v: any) => [`Rp ${v.toLocaleString('id-ID')}`, 'Pendapatan']} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgb(0 0 0 / 0.1)' }} />
                  <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={3} dot={{ r: 5, fill: '#3b82f6', strokeWidth: 2, stroke: 'white' }} activeDot={{ r: 7 }} />
                </LineChart>
              </ResponsiveContainer></div>
            </div>

            {/* === SECTION 3 & 4: PIE + BEST SELLER SIDE BY SIDE === */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Payment Method Donut */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-800 mb-4 uppercase tracking-wider">Metode Pembayaran</h3>
                {analyticsData.payMethodChart.length > 0 ? (
                  <div className="h-52"><ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={analyticsData.payMethodChart} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {analyticsData.payMethodChart.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => `Rp ${v.toLocaleString('id-ID')}`} />
                    </PieChart>
                  </ResponsiveContainer></div>
                ) : <p className="text-gray-400 text-center py-10 text-sm">Belum ada data pembayaran</p>}
              </div>

              {/* Best Sellers */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-800 mb-4 uppercase tracking-wider">🔥 Produk Terlaris</h3>
                {analyticsData.bestSellerChart.length > 0 ? (
                  <div className="h-52"><ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsData.bestSellerChart} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <YAxis type="category" dataKey="name" width={100} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#374151' }} />
                      <Tooltip formatter={(v: any) => [`${v} pcs`, 'Terjual']} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgb(0 0 0 / 0.1)' }} />
                      <Bar dataKey="sold" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer></div>
                ) : <p className="text-gray-400 text-center py-10 text-sm">Belum ada data penjualan</p>}
              </div>
            </div>

            {/* Kategori (pie) + Kurang laris */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-800 mb-1 uppercase tracking-wider flex items-center gap-2">
                  <PieChartIcon size={16} /> Penjualan per kategori
                </h3>
                <p className="text-[10px] text-gray-400 mb-4">Estimasi dari nama produk (Makanan / Minuman / Snack / Lainnya)</p>
                {analyticsData.categoryChart.length > 0 ? (
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={analyticsData.categoryChart}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={72}
                          paddingAngle={3}
                          label={(props: any) => `${props.name ?? ""} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                        >
                          {analyticsData.categoryChart.map((_: unknown, i: number) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: any) => `Rp ${Number(v ?? 0).toLocaleString("id-ID")}`} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-gray-400 text-center py-10 text-sm">Belum ada penjualan di periode ini</p>
                )}
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-800 mb-1 uppercase tracking-wider">📉 Kurang laris (dead stock)</h3>
                <p className="text-[10px] text-gray-400 mb-4">Unit terjual di periode ini — rendah ke tinggi</p>
                {analyticsData.worstSellerChart.length > 0 ? (
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analyticsData.worstSellerChart} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" width={100} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#374151" }} />
                        <Tooltip formatter={(v: any) => [`${v ?? 0} pcs`, "Terjual"]} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)" }} />
                        <Bar dataKey="sold" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-gray-400 text-center py-10 text-sm">Belum ada data inventori</p>
                )}
              </div>
            </div>

            {/* === SECTION 5: RUSH HOUR ANALYSIS === */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-sm font-bold text-gray-800 mb-4 uppercase tracking-wider flex items-center gap-2"><Clock size={16} /> Analisa Jam Sibuk</h3>
              {analyticsData.rushHourChart.length > 0 ? (
                <div className="h-52"><ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analyticsData.rushHourChart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} dy={5} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6b7280' }} allowDecimals={false} />
                    <Tooltip formatter={(v: any) => [`${v} transaksi`, 'Jumlah']} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer></div>
              ) : <p className="text-gray-400 text-center py-10 text-sm">Belum ada data transaksi per jam</p>}
              <p className="text-xs text-gray-400 mt-3 text-center">Grafik menampilkan distribusi jumlah transaksi per jam. Jam dengan bar paling tinggi = jam tersibuk Anda.</p>
            </div>

            {/* === SECTION: EXPORT & GOOGLE SHEETS === */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-sm font-bold text-gray-800 mb-4 uppercase tracking-wider flex items-center gap-2"><FileSpreadsheet size={16} /> Export & Integrasi</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <button
                  onClick={() => exportTransactionsXlsx(history)}
                  className="flex items-center justify-center gap-2 bg-green-50 hover:bg-green-100 text-green-700 font-bold py-3 px-4 rounded-xl border border-green-200 transition-all active:scale-95 text-sm"
                >
                  <Download size={16} /> Transaksi (.xlsx)
                </button>
                <button
                  onClick={() => exportInventoryXlsx(inventory, inventorySoldMap)}
                  className="flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-3 px-4 rounded-xl border border-blue-200 transition-all active:scale-95 text-sm"
                >
                  <Download size={16} /> Inventori (.xlsx)
                </button>
                <button
                  onClick={() => exportFullReportXlsx(history, inventory, inventorySoldMap, expenses)}
                  className="flex items-center justify-center gap-2 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold py-3 px-4 rounded-xl border border-purple-200 transition-all active:scale-95 text-sm"
                >
                  <FileSpreadsheet size={16} /> Laporan Lengkap (.xlsx)
                </button>
                <button
                  onClick={async () => {
                    setIsSyncing(true); setSyncResult(null);
                    const result = await syncToGoogleSheets({ transactions: history, inventory, soldMap: inventorySoldMap, expenses });
                    setSyncResult(result); setIsSyncing(false);
                  }}
                  disabled={isSyncing}
                  className="flex items-center justify-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold py-3 px-4 rounded-xl border border-emerald-200 transition-all active:scale-95 text-sm disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <Sheet size={16} />}
                  {isSyncing ? 'Sync...' : 'Sync Google Sheets'}
                </button>
              </div>
              {syncResult && (
                <div className={`mt-3 p-3 rounded-xl text-sm font-medium flex items-center justify-between ${syncResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  <span>{syncResult.message}</span>
                  {syncResult.url && (
                    <a href={syncResult.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-green-700 transition-colors">
                      <ExternalLink size={12} /> Buka Sheets
                    </a>
                  )}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ================= TAB EXPENSES ================= */}
        {activeTab === "expenses" && authRole === "owner" && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-black text-gray-800 uppercase tracking-wider flex items-center gap-2"><Receipt size={20} className="text-red-500" /> Pengeluaran Toko</h3>
                <button onClick={() => setShowExpenseForm(!showExpenseForm)} className="text-xs bg-red-50 text-red-600 font-bold px-4 py-2 rounded-xl border border-red-200 hover:bg-red-100 flex items-center gap-1.5 transition-all"><PlusCircle size={16} /> {showExpenseForm ? 'Tutup Form' : 'Catat Biaya Baru'}</button>
              </div>
              
              {showExpenseForm && (
                <div className="space-y-4 bg-red-50/50 p-6 rounded-[2rem] border border-red-100 mb-6 animate-in slide-in-from-top-4 duration-300">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-black text-red-600 uppercase tracking-[0.2em]">{editingExpense ? '⚡ Mode Edit Biaya' : '📝 Input Biaya Baru'}</p>
                    {editingExpense && <button onClick={() => { setEditingExpense(null); setExpenseDesc(""); setExpenseAmount(0); setShowExpenseForm(false); }} className="text-xs bg-white px-3 py-1.5 rounded-xl border border-red-200 text-red-500 font-bold hover:bg-red-50 shadow-sm">Batal Edit</button>}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase ml-2">Kategori</label>
                      <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)} className="w-full border border-gray-200 rounded-2xl p-3.5 text-sm bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-red-500 transition-all">
                        <option>Kulakan</option><option>Listrik</option><option>Sewa</option><option>Gaji</option><option>Operasional</option><option>Lainnya</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase ml-2">Deskripsi</label>
                      <input type="text" placeholder="Contoh: Beli Kopi 5kg" className="w-full border border-gray-200 rounded-2xl p-3.5 text-sm text-slate-900 font-medium outline-none focus:ring-2 focus:ring-red-500 transition-all" value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase ml-2">Jumlah (Rp)</label>
                      <input type="number" placeholder="Rp 0" className="w-full border border-gray-200 rounded-2xl p-3.5 text-sm font-black text-slate-900 outline-none focus:ring-2 focus:ring-red-500 transition-all" value={expenseAmount || ""} onChange={e => setExpenseAmount(Number(e.target.value) || "")} />
                    </div>
                  </div>
                  
                  <button onClick={handleAddExpense} className={`w-full ${editingExpense ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30' : 'bg-red-500 hover:bg-red-600 shadow-red-500/30'} text-white font-black py-4 rounded-2xl transition-all active:scale-95 shadow-lg text-sm uppercase tracking-widest`}>
                    {editingExpense ? 'Simpan Perubahan' : 'Posting Pengeluaran'}
                  </button>
                </div>
              )}

              {expenses.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-[2rem] border border-dashed border-gray-200">
                  <Receipt size={40} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-gray-400 font-medium text-sm">Belum ada catatan pengeluaran.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {expenses.map((exp: any) => (
                    <div key={exp.id} className="flex justify-between items-center py-4 text-sm group hover:bg-slate-50 rounded-xl px-3 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                          <Receipt size={18} />
                        </div>
                        <div>
                          <p className="font-black text-gray-800 text-base">{exp.description}</p>
                          <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">{exp.category} • {new Date(exp.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-6">
                        <p className="font-black text-red-600 text-lg">-Rp {(exp.amount || 0).toLocaleString('id-ID')}</p>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100">
                          <button onClick={() => handleOpenEditExpense(exp)} className="p-2.5 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-600 hover:text-white transition-all shadow-sm" title="Edit"><Edit size={16} /></button>
                          <button onClick={() => handleDeleteExpense(exp.id)} className="p-2.5 bg-red-50 text-red-600 rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-sm" title="Hapus"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl flex items-start gap-3">
              <Info size={20} className="text-blue-500 mt-0.5" />
              <div className="text-xs text-blue-800 leading-relaxed font-medium">
                <p className="font-black uppercase mb-1">💡 Tips Pengelolaan Data</p>
                Semua pengeluaran yang Anda catat akan otomatis diperhitungkan sebagai **HPP/Operasional** pada dashboard Analytics untuk menghitung Laba Bersih yang akurat. Pastikan untuk melakukan **Sync Google Sheets** di tab Analytics agar laporan di cloud tetap up-to-date.
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB HISTORY ================= */}
        {activeTab === "history" && (
          <div className="space-y-4 animate-in fade-in duration-300 max-w-3xl">

            {/* Period Filter */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Filter Periode Riwayat</p>
              <div className="flex flex-wrap gap-2">
                {([['today', 'Hari Ini'], ['week', 'Minggu Ini'], ['month', 'Bulan Ini'], ['year', 'Tahun Ini'], ['custom', 'Pilih Tanggal']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setHistPeriod(key)} className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${histPeriod === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}>{label}</button>
                ))}
              </div>
              {histPeriod === 'custom' && (
                <div className="flex gap-2 mt-3">
                  <input type="date" value={histCustomFrom} onChange={e => setHistCustomFrom(e.target.value)} className="flex-1 border border-gray-300 rounded-lg p-2 text-sm text-slate-900" />
                  <span className="text-gray-400 self-center text-sm">s/d</span>
                  <input type="date" value={histCustomTo} onChange={e => setHistCustomTo(e.target.value)} className="flex-1 border border-gray-300 rounded-lg p-2 text-sm text-slate-900" />
                </div>
              )}
              {/* Summary */}
              <div className="flex gap-4 mt-3 pt-3 border-t border-gray-100">
                <div><p className="text-[10px] text-gray-400 font-bold uppercase">Transaksi</p><p className="font-black text-slate-800">{filteredHistory.filter(t => t.status === 'paid').length}</p></div>
                <div><p className="text-[10px] text-gray-400 font-bold uppercase">Pendapatan</p><p className="font-black text-green-600">Rp {filteredHistory.filter(t => t.status === 'paid').reduce((s: number, t: any) => s + (t.total_amount || 0), 0).toLocaleString('id-ID')}</p></div>
                <div><p className="text-[10px] text-gray-400 font-bold uppercase">Batal</p><p className="font-black text-red-500">{filteredHistory.filter(t => t.status === 'cancelled').length}</p></div>
              </div>
              {authRole === 'owner' && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => exportTransactionsXlsx(filteredHistory)}
                    className="flex items-center gap-1.5 bg-green-50 hover:bg-green-100 text-green-700 font-bold py-2 px-3 rounded-lg border border-green-200 transition-all active:scale-95 text-xs"
                  >
                    <Download size={14} /> Export Excel
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
              {filteredHistory.length === 0 ? (
                <div className="p-10 text-center text-gray-400 text-sm">Tidak ada transaksi di periode ini.</div>
              ) : filteredHistory.map(trx => (
                <div key={trx.id} onClick={() => setViewingTrx(trx)} className="p-4 flex flex-wrap justify-between items-center hover:bg-gray-50 cursor-pointer group">
                  <div className="w-1/2"><p className="font-bold text-slate-800 uppercase text-sm">{trx.customer_name || "TANPA NAMA"}</p><p className="text-[10px] text-gray-400 font-mono mt-0.5">{new Date(trx.created_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</p></div>
                  <div className="w-1/4 text-center"><span className={`text-[9px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${trx.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{trx.status}</span></div>
                  <div className="w-1/4 text-right"><p className={`font-black text-sm ${trx.status === 'paid' ? 'text-slate-800' : 'text-gray-400 line-through'}`}>Rp {(trx.total_amount || 0).toLocaleString('id-ID')}</p></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= TAB INVENTORY (OWNER ONLY) ================= */}
        {activeTab === "inventory" && authRole === 'owner' && (
          <div className="space-y-5 animate-in fade-in duration-300">

            {/* Period Filter */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Filter Penjualan Terjual</p>
              <div className="flex flex-wrap gap-2">
                {([['today', 'Hari Ini'], ['week', 'Minggu Ini'], ['month', 'Bulan Ini'], ['year', 'Tahun Ini'], ['custom', 'Pilih Tanggal']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setInvPeriod(key)} className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${invPeriod === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}>{label}</button>
                ))}
              </div>
              {invPeriod === 'custom' && (
                <div className="flex gap-2 mt-3">
                  <input type="date" value={invCustomFrom} onChange={e => setInvCustomFrom(e.target.value)} className="flex-1 border border-gray-300 rounded-lg p-2 text-sm text-slate-900" />
                  <span className="text-gray-400 self-center text-sm">s/d</span>
                  <input type="date" value={invCustomTo} onChange={e => setInvCustomTo(e.target.value)} className="flex-1 border border-gray-300 rounded-lg p-2 text-sm text-slate-900" />
                </div>
              )}
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              {!scanMode ? (
                <div className="flex gap-2">
                  <input type="text" placeholder="Cari Barcode / SKU / Nama..." className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-slate-900 font-medium focus:ring-2 focus:ring-blue-500 outline-none" value={manualBarcode} onChange={e => setManualBarcode(e.target.value)} onKeyDown={e => e.key === 'Enter' && findInventory(manualBarcode)} />
                  <button onClick={() => findInventory(manualBarcode)} className="bg-blue-600 text-white px-5 rounded-xl" title="Cari"><Search size={18} /></button>
                  <button onClick={() => setScanMode(true)} className="bg-slate-800 text-white px-4 rounded-xl flex items-center justify-center gap-2" title="Gunakan Kamera HP/Laptop"><ScanLine size={18} /><span className="hidden sm:inline text-xs font-bold">Kamera</span></button>
                </div>
              ) : (
                <div className="space-y-3"><div className="rounded-xl overflow-hidden border-2 border-slate-200"><Scanner ref={scannerRef} onScan={handleScanInventory} /></div><button onClick={handleBatalScan} className="w-full bg-gray-200 font-bold py-2 rounded-xl text-sm leading-none flex items-center justify-center h-12">Batal Scan</button></div>
              )}
              {isNewProduct && (
                <div className="mt-5 bg-orange-50 p-5 rounded-xl border border-orange-200 space-y-3">
                  <p className="font-bold text-orange-600 mb-2">Registrasi Produk Baru</p>
                  <input type="text" placeholder="Nama Produk" className="w-full border p-3 rounded-xl text-sm text-slate-900 font-bold" value={newProductName} onChange={e => setNewProductName(e.target.value)} />
                  
                  <div className="bg-white p-3 border rounded-xl">
                    <p className="text-[10px] font-bold text-gray-400 mb-2 uppercase tracking-widest">Pilih Kategori</p>
                    <div className="flex gap-2">
                      {['Makanan', 'Minuman', 'Lainnya'].map(cat => (
                        <button key={cat} onClick={() => setNewProductCategory(cat)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all border ${newProductCategory === cat ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>{cat}</button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3"><input type="number" placeholder="Rp Jual" className="flex-1 border p-3 rounded-xl text-sm text-slate-900 font-bold" value={newProductPrice} onChange={e => setNewProductPrice(Number(e.target.value) || "")} /><input type="number" placeholder="Rp HPP/Modal" className="flex-1 border p-3 rounded-xl text-sm text-slate-900 font-bold" value={newProductHpp} onChange={e => setNewProductHpp(Number(e.target.value) || "")} /><input type="number" placeholder="Stok Awal" className="flex-1 border p-3 rounded-xl text-sm text-slate-900 font-bold" value={newProductStock} onChange={e => setNewProductStock(Number(e.target.value) || "")} /></div>

                  <div className="bg-white p-3 border rounded-xl">
                    <p className="text-[10px] font-bold text-gray-400 mb-2 uppercase">Gambar Produk (Opsional)</p>
                    {newProductImage ? (
                      <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                        <img src={newProductImage} className="w-full h-full object-cover" />
                        <button onClick={() => setNewProductImage("")} className="absolute top-1 right-1 bg-white/80 hover:bg-white rounded-full p-1 shadow"><X size={12} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, setNewProductImage)} className="text-xs file:bg-blue-50 file:border-0 file:text-blue-700 file:font-bold file:px-3 file:py-1.5 file:rounded-lg hover:file:bg-blue-100 transition-all flex-1" disabled={isUploading} />
                        {isUploading && <span className="text-xs text-blue-600 font-bold animate-pulse">Wait...</span>}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2"><button onClick={() => setIsNewProduct(false)} className="flex-1 bg-white rounded-xl py-3 font-bold border">Batal</button><button onClick={handleRegisterProduct} className="flex-[2] bg-orange-500 text-white font-bold rounded-xl py-3 shadow-md">Simpan Produk</button></div>
                </div>
              )}
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
              {filteredInventory.length === 0 ? (
                <div className="p-10 text-center text-gray-400 text-sm">Tidak ada produk yang sesuai pencarian.</div>
              ) : filteredInventory.map(item => {
                const dynamicSold = inventorySoldMap[item.id] || 0;
                return (
                  <div key={item.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                    <div className="flex items-center gap-4 flex-1">
                      <img src={item.image_url || "https://placehold.co/100x100?text=No+Img"} className="w-12 h-12 rounded-lg object-cover bg-gray-100" />
                      <div>
                        <p className="font-bold text-gray-800 text-sm">{item.variant_name || item.products?.name}</p>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded">Terjual: {dynamicSold}</span>
                          <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded">Total: {item.sold_count || 0}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-center w-24"><p className="text-sm font-bold text-gray-800">Rp {(item.price || 0).toLocaleString('id-ID')}</p></div>
                    <div className="flex items-center gap-3 w-32 justify-end">
                      <div className="text-center"><p className="text-[10px] uppercase font-bold text-gray-400">Stok</p><p className={`font-black text-lg leading-none ${item.stock <= 5 ? 'text-red-500' : 'text-slate-800'}`}>{item.stock || 0}</p></div>
                      <button onClick={() => openEditProduct(item)} className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Edit size={16} /></button>
                      <button onClick={() => { setEditingProduct(item); handleDeleteProduct(); }} className="p-2 bg-red-50 text-red-600 rounded-lg"><Trash2 size={16} /></button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Export Inventory Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => exportInventoryXlsx(inventory, inventorySoldMap)}
                className="flex items-center gap-1.5 bg-green-50 hover:bg-green-100 text-green-700 font-bold py-2.5 px-4 rounded-xl border border-green-200 transition-all active:scale-95 text-xs"
              >
                <Download size={14} /> Export Inventori (.xlsx)
              </button>
              <button
                onClick={async () => {
                  setIsSyncing(true); setSyncResult(null);
                  const result = await syncToGoogleSheets({ transactions: history, inventory, soldMap: inventorySoldMap, expenses });
                  setSyncResult(result); setIsSyncing(false);
                  if (result.success) alert('✅ ' + result.message);
                  else alert('❌ ' + result.message);
                }}
                disabled={isSyncing}
                className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold py-2.5 px-4 rounded-xl border border-emerald-200 transition-all active:scale-95 text-xs disabled:opacity-50"
              >
                {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <Sheet size={14} />}
                {isSyncing ? 'Syncing...' : 'Sync Google Sheets'}
              </button>
            </div>
          </div>
        )}
        {/* ================= TAB SETTINGS ================= */}
        {activeTab === "settings" && authRole === "owner" && (
          <div className="space-y-6 animate-in fade-in duration-300 max-w-2xl mx-auto">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
                  <Clock size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-gray-800">Pengaturan Pengingat Sync</h3>
                  <p className="text-xs text-gray-400 font-medium">Atur jam munculnya peringatan Google Sheets</p>
                </div>
              </div>

              <div className="space-y-5">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🕒</span>
                    <div>
                      <p className="font-bold text-gray-800 text-sm">Peringatan Siang</p>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Default: Jam 12:00</p>
                    </div>
                  </div>
                  <input 
                    type="number" min="0" max="23" 
                    className="w-20 bg-white border border-gray-200 rounded-xl p-3 text-center font-black text-slate-800" 
                    value={remindMidday}
                    onChange={(e) => saveSyncSettings(Number(e.target.value), remindEvening, remindClosing)}
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🌆</span>
                    <div>
                      <p className="font-bold text-gray-800 text-sm">Peringatan Sore</p>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Default: Jam 17:00</p>
                    </div>
                  </div>
                  <input 
                    type="number" min="0" max="23" 
                    className="w-20 bg-white border border-gray-200 rounded-xl p-3 text-center font-black text-slate-800" 
                    value={remindEvening}
                    onChange={(e) => saveSyncSettings(remindMidday, Number(e.target.value), remindClosing)}
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🌙</span>
                    <div>
                      <p className="font-bold text-gray-800 text-sm">Peringatan Tutup Toko</p>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Default: Jam 22:00</p>
                    </div>
                  </div>
                  <input 
                    type="number" min="0" max="23" 
                    className="w-20 bg-white border border-gray-200 rounded-xl p-3 text-center font-black text-slate-800" 
                    value={remindClosing}
                    onChange={(e) => saveSyncSettings(remindMidday, remindEvening, Number(e.target.value))}
                  />
                </div>
              </div>
              
              <div className="mt-8 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Info size={14} /> Cara Kerja Pengingat
                </p>
                <ul className="text-[11px] text-amber-800 space-y-2 font-medium leading-relaxed">
                  <li className="flex gap-2"><span>•</span> <span><b>Peringatan Kecil (Persiapan):</b> Muncul otomatis 10 menit sebelum jam yang ditentukan (misal 21:50) untuk mengingatkan Anda bersiap melakukan sinkronisasi.</span></li>
                  <li className="flex gap-2"><span>•</span> <span><b>Peringatan Utama:</b> Muncul tepat pada jam yang ditentukan (misal 22:00) dengan efek animasi berkedip agar lebih perhatian.</span></li>
                  <li className="flex gap-2"><span>•</span> <span><b>Penyimpanan:</b> Aturan ini disimpan di browser Anda dan hanya berlaku pada perangkat ini.</span></li>
                </ul>
              </div>
            </div>
            
            <div className="text-center opacity-40 hover:opacity-100 transition-opacity">
              <p className="text-[10px] font-bold text-gray-400">Settings Version 1.2 • KEDAI KELUARGA POS</p>
            </div>
          </div>
        )}
      </div>

      {editingProduct && authRole === 'owner' && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6 space-y-4">
            <h3 className="font-bold text-slate-800 border-b pb-3 flex justify-between">Ubah Data <X size={20} className="cursor-pointer" onClick={() => setEditingProduct(null)} /></h3>
            <div><label className="text-xs font-bold text-gray-600 block mb-1">Nama Produk</label><input type="text" className="w-full border p-3 rounded-xl text-sm text-slate-900 font-bold" value={editProductName} onChange={(e) => setEditProductName(e.target.value)} /></div>
            <div><label className="text-xs font-bold text-gray-600 block mb-1">Kode Barcode / SKU</label><input type="text" className="w-full border p-3 rounded-xl text-sm text-slate-900 font-bold" value={editProductBarcode} onChange={(e) => setEditProductBarcode(e.target.value)} /></div>
            
            <div className="bg-slate-50 p-3 border rounded-xl">
              <label className="text-[10px] font-bold text-gray-400 block mb-2 uppercase tracking-widest">Kategori Produk</label>
              <div className="flex gap-2">
                {['Makanan', 'Minuman', 'Lainnya'].map(cat => (
                  <button key={cat} onClick={() => setEditProductCategory(cat)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all border ${editProductCategory === cat ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-400 border-gray-200'}`}>{cat}</button>
                ))}
              </div>
            </div>

            <div className="flex gap-4"><div className="flex-1"><label className="text-xs font-bold text-gray-600 block mb-1">Harga Jual (Rp)</label><input type="number" className="w-full border p-3 rounded-xl text-sm text-slate-900 font-medium" value={editProductPrice} onChange={(e) => setEditProductPrice(Number(e.target.value) || "")} /></div><div className="flex-1"><label className="text-xs font-bold text-gray-600 block mb-1">HPP / Modal (Rp)</label><input type="number" className="w-full border p-3 rounded-xl text-sm text-slate-900 font-medium" value={editProductHpp} onChange={(e) => setEditProductHpp(Number(e.target.value) || "")} /></div><div className="flex-1"><label className="text-xs font-bold text-gray-600 block mb-1">Stok</label><input type="number" className="w-full border p-3 rounded-xl text-sm text-slate-900 font-medium" value={editProductStock} onChange={(e) => setEditProductStock(Number(e.target.value) || "")} /></div></div>

            <div className="bg-slate-50 p-3 border rounded-xl">
              <label className="text-[10px] font-bold text-gray-400 block mb-2 uppercase">Ubah Gambar Produk</label>
              {editProductImage ? (
                <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-300 shadow-sm">
                  <img src={editProductImage} className="w-full h-full object-cover" />
                  <button onClick={() => setEditProductImage("")} className="absolute top-1 right-1 bg-white/80 hover:bg-white rounded-full p-1 shadow"><X size={12} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, setEditProductImage)} className="text-xs file:bg-blue-50 file:border-0 file:text-blue-700 file:font-bold file:px-3 file:py-1.5 file:rounded-lg hover:file:bg-blue-100 transition-all flex-1" disabled={isUploading} />
                  {isUploading && <span className="text-xs text-blue-600 font-bold animate-pulse">Wait...</span>}
                </div>
              )}
            </div>

            <div className="pt-2 flex gap-2"><button onClick={handleDeleteProduct} className="flex-1 bg-red-100 text-red-700 font-bold py-3 rounded-xl">Hapus</button><button onClick={handleUpdateProduct} className="flex-[2] bg-blue-600 text-white font-bold py-3 rounded-xl">Simpan</button></div>
          </div>
        </div>
      )}

      {/* Modal Transaction */}
      {viewingTrx && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 overflow-y-auto no-print">
          <div className="min-h-full flex justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl flex flex-col my-auto overflow-hidden">
              <div className={`p-4 border-b flex justify-between items-center ${viewingTrx.status === 'paid' ? 'bg-green-100' : 'bg-slate-100'}`}><h3 className="font-bold flex items-center gap-2">{viewingTrx.status === 'paid' ? 'LUNAS' : viewingTrx.status === 'cancelled' ? 'BATAL' : 'DETAIL TRANSAKSI'}</h3></div>
              <div id="printable-receipt" className="p-5 font-mono text-xs sm:text-sm text-black">
                <div className="text-center font-bold text-lg">Kedai Keluarga</div><div className="border-b-2 border-dashed border-gray-400 my-2"></div>
                <div className="flex justify-between"><span>Plg:</span><span className="font-bold">{viewingTrx.customer_name || '-'}</span></div>
                <div className="flex justify-between"><span>Meja:</span><span className="font-bold uppercase">{viewingTrx.table_number || '-'}</span></div>
                <div className="flex justify-between mb-2"><span>Tgl:</span><span>{new Date(viewingTrx.created_at).toLocaleString('id-ID')}</span></div>
                <div className="border-b-2 border-dashed border-gray-400 my-2"></div>
                <div className="space-y-1">{viewingTrx.transaction_items?.map((item: any) => (<div key={item.id}><div className="font-bold">{item.product_variants?.variant_name?.substring(0, 30)}</div><div className="flex justify-between"><span>{item.quantity} x {(item.unit_price || item.price || 0)}</span><span>{(item.quantity * (item.unit_price || item.price || 0))}</span></div></div>))}</div>
                <div className="border-b-2 border-dashed border-gray-400 my-2"></div>
                <div className="flex justify-between text-base font-bold mb-3"><span>TOTAL</span><span>Rp {(viewingTrx.total_amount || 0).toLocaleString('id-ID')}</span></div>
              </div>
              <div className="p-4 bg-slate-50 border-t flex flex-col gap-2 rounded-b-3xl">
                {viewingTrx.status === 'pending' && authRole && (
                  <>
                    <div className="flex gap-2 mb-2">
                      {['Tunai', 'QRIS', 'Transfer'].map(method => (
                        <button key={method} onClick={() => setPaymentMethod(method)} className={`flex-1 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${paymentMethod === method ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}>{method}</button>
                      ))}
                    </div>
                    <button onClick={handleProcessPayment} className="w-full bg-green-500 hover:bg-green-600 text-white font-black py-4 rounded-xl">💰 BAYAR ({paymentMethod})</button>
                    <button onClick={() => setShowCancelConfirm(true)} className="w-full bg-red-100 text-red-700 font-bold py-2 rounded-xl">Batalkan Pesanan (Miskom)</button>
                  </>
                )}
                <div className="flex gap-2">
                  <button onClick={handlePrintPDF} className="flex-1 bg-white border border-gray-300 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1"><Download size={16} /> Unduh PDF</button>
                  <button onClick={handlePrintBluetooth} className="flex-1 bg-slate-900 text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1"><Smartphone size={16} /> Print Kasir</button>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setViewingTrx(null)} className="flex-[3] bg-gray-200 text-gray-800 font-bold py-3 rounded-xl"><X size={18} className="inline" /> Tutup Modal</button>
                  {viewingTrx.status !== 'pending' && <button onClick={() => setShowDeleteConfirm(true)} className="flex-1 flex justify-center items-center bg-red-50 text-red-600 rounded-xl border border-red-200"><Trash2 size={20} /></button>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM CONFIRM MODALS FOR TRANSACTION DELETION & CANCELLATION */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 text-center shadow-2xl zoom-in-95">
            <div className="w-16 h-16 bg-red-100 rounded-full mx-auto flex items-center justify-center text-red-600 mb-4"><Trash2 size={32} /></div>
            <h3 className="text-xl font-black text-slate-800 mb-2">Hapus Permanen?</h3>
            <p className="text-sm text-gray-500 mb-6">Jika transaksi ini sudah lunas, stok akan otomatis dikembalikan ke Inventori.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 bg-gray-100 text-gray-700 font-bold py-3 rounded-xl">Batal</button>
              <button onClick={handleDeleteTrx} className="flex-1 bg-red-600 text-white font-bold py-3 rounded-xl shadow-lg">Ya, Hapus</button>
            </div>
          </div>
        </div>
      )}

      {showCancelConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 text-center shadow-2xl zoom-in-95">
            <div className="w-16 h-16 bg-orange-100 rounded-full mx-auto flex items-center justify-center text-orange-600 mb-4"><AlertCircle size={32} /></div>
            <h3 className="text-xl font-black text-slate-800 mb-2">Batalkan Pesanan?</h3>
            <p className="text-sm text-gray-500 mb-6">Membatalkan (Void) pesanan ini berarti tidak memotong stok apapun dari inventori Anda.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowCancelConfirm(false)} className="flex-1 bg-gray-100 text-gray-700 font-bold py-3 rounded-xl">Kembali</button>
              <button onClick={handleCancelOrder} className="flex-1 bg-orange-500 text-white font-bold py-3 rounded-xl shadow-lg">Batalkan</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
