import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
//  XLSX Helpers – runs entirely on the client (no API route needed)
// ---------------------------------------------------------------------------

/** Format a date to Indonesian locale string */
const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const currency = (n: number) => n; // keep as number so Excel can SUM

// ---------------------------------------------------------------------------
//  Export Transactions (History)
// ---------------------------------------------------------------------------
export function exportTransactionsXlsx(history: any[]) {
  const rows = history
    .filter((t) => t.status === "paid")
    .map((trx) => {
      const items = (trx.transaction_items || [])
        .map(
          (it: any) =>
            `${it.product_variants?.variant_name || it.product_variants?.products?.name || "Item"} x${it.quantity}`
        )
        .join(", ");

      const totalHpp = (trx.transaction_items || []).reduce(
        (s: number, it: any) =>
          s + (it.product_variants?.hpp || 0) * it.quantity,
        0
      );

      return {
        "Tanggal": fmtDate(trx.created_at),
        "ID Transaksi": trx.id?.substring(0, 8).toUpperCase(),
        "Pelanggan": trx.customer_name || "-",
        "Meja": trx.table_number || "-",
        "Item": items,
        "Total (Rp)": currency(trx.total_amount || 0),
        "HPP (Rp)": currency(totalHpp),
        "Laba Kotor (Rp)": currency((trx.total_amount || 0) - totalHpp),
        "Metode Bayar": trx.payment_method || "Tunai",
        "Status": trx.status,
      };
    });

  if (rows.length === 0) {
    alert("Tidak ada transaksi LUNAS untuk diekspor.");
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-width columns
  const colWidths = Object.keys(rows[0]).map((key) => ({
    wch: Math.max(
      key.length,
      ...rows.map((r) => String((r as any)[key]).length)
    ) + 2,
  }));
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transaksi");
  XLSX.writeFile(
    wb,
    `Transaksi_KedaiKeluarga_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

// ---------------------------------------------------------------------------
//  Export Inventory
// ---------------------------------------------------------------------------
export function exportInventoryXlsx(
  inventory: any[],
  soldMap: Record<string, number>
) {
  const rows = inventory.map((item) => ({
    "Nama Produk": item.variant_name || item.products?.name || "-",
    "Barcode": item.barcode || "-",
    "Harga Jual (Rp)": currency(item.price || 0),
    "HPP / Modal (Rp)": currency(item.hpp || 0),
    "Margin (Rp)": currency((item.price || 0) - (item.hpp || 0)),
    "Stok Saat Ini": item.stock || 0,
    "Terjual (Periode)": soldMap[item.id] || 0,
    "Total Terjual": item.sold_count || 0,
  }));

  if (rows.length === 0) {
    alert("Tidak ada data inventori.");
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const colWidths = Object.keys(rows[0]).map((key) => ({
    wch: Math.max(
      key.length,
      ...rows.map((r) => String((r as any)[key]).length)
    ) + 2,
  }));
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventori");
  XLSX.writeFile(
    wb,
    `Inventori_KedaiKeluarga_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

// ---------------------------------------------------------------------------
//  Export Combined Report (Transactions + Inventory in one workbook)
// ---------------------------------------------------------------------------
export function exportFullReportXlsx(
  history: any[],
  inventory: any[],
  soldMap: Record<string, number>,
  expenses: any[]
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Transaksi
  const trxRows = history
    .filter((t) => t.status === "paid")
    .map((trx) => {
      const items = (trx.transaction_items || [])
        .map(
          (it: any) =>
            `${it.product_variants?.variant_name || it.product_variants?.products?.name || "Item"} x${it.quantity}`
        )
        .join(", ");
      const totalHpp = (trx.transaction_items || []).reduce(
        (s: number, it: any) =>
          s + (it.product_variants?.hpp || 0) * it.quantity,
        0
      );
      return {
        "Tanggal": fmtDate(trx.created_at),
        "ID Transaksi": trx.id?.substring(0, 8).toUpperCase(),
        "Pelanggan": trx.customer_name || "-",
        "Meja": trx.table_number || "-",
        "Item": items,
        "Total (Rp)": currency(trx.total_amount || 0),
        "HPP (Rp)": currency(totalHpp),
        "Laba Kotor (Rp)": currency((trx.total_amount || 0) - totalHpp),
        "Metode Bayar": trx.payment_method || "Tunai",
      };
    });

  if (trxRows.length > 0) {
    const ws1 = XLSX.utils.json_to_sheet(trxRows);
    ws1["!cols"] = Object.keys(trxRows[0]).map((key) => ({
      wch: Math.max(key.length, ...trxRows.map((r) => String((r as any)[key]).length)) + 2,
    }));
    XLSX.utils.book_append_sheet(wb, ws1, "Transaksi");
  }

  // Sheet 2: Inventori
  const invRows = inventory.map((item) => ({
    "Nama Produk": item.variant_name || item.products?.name || "-",
    "Barcode": item.barcode || "-",
    "Harga Jual (Rp)": currency(item.price || 0),
    "HPP / Modal (Rp)": currency(item.hpp || 0),
    "Stok Saat Ini": item.stock || 0,
    "Terjual (Periode)": soldMap[item.id] || 0,
    "Total Terjual": item.sold_count || 0,
  }));

  if (invRows.length > 0) {
    const ws2 = XLSX.utils.json_to_sheet(invRows);
    ws2["!cols"] = Object.keys(invRows[0]).map((key) => ({
      wch: Math.max(key.length, ...invRows.map((r) => String((r as any)[key]).length)) + 2,
    }));
    XLSX.utils.book_append_sheet(wb, ws2, "Inventori");
  }

  // Sheet 3: Pengeluaran
  const expRows = expenses.map((exp) => ({
    "Tanggal": fmtDate(exp.created_at),
    "Kategori": exp.category || "-",
    "Deskripsi": exp.description || "-",
    "Jumlah (Rp)": currency(exp.amount || 0),
  }));

  if (expRows.length > 0) {
    const ws3 = XLSX.utils.json_to_sheet(expRows);
    ws3["!cols"] = Object.keys(expRows[0]).map((key) => ({
      wch: Math.max(key.length, ...expRows.map((r) => String((r as any)[key]).length)) + 2,
    }));
    XLSX.utils.book_append_sheet(wb, ws3, "Pengeluaran");
  }

  XLSX.writeFile(
    wb,
    `Laporan_KedaiKeluarga_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}
