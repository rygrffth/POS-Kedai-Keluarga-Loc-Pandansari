import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

// ---------------------------------------------------------------------------
//  POST /api/sync-sheets
//  Receives transaction, inventory & expense data and writes it to
//  a Google Spreadsheet (3 sheets: Transaksi, Inventori, Pengeluaran).
//
//  Required env vars:
//    GOOGLE_SHEETS_ID            – the spreadsheet ID from the URL
//    GOOGLE_SERVICE_ACCOUNT_EMAIL – service account email
//    GOOGLE_PRIVATE_KEY          – service account private key (PEM)
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    
    // Pastikan private key bersih dari tanda petik dan menangani format newline dengan benar
    let privateKey = process.env.GOOGLE_PRIVATE_KEY || "";
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, "\n");

    if (!spreadsheetId || !clientEmail || !privateKey) {
      return NextResponse.json(
        {
          error:
            "Google Sheets belum dikonfigurasi. Pastikan GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, dan GOOGLE_PRIVATE_KEY sudah diset di Environment Variables.",
        },
        { status: 400 }
      );
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const { transactions, inventory, soldMap, expenses } = await req.json();

    // ── Helper: format date ─────────────────────────────────────────────
    const fmtDate = (d: string) =>
      new Date(d).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

    // ── Build rows for each sheet ───────────────────────────────────────

    // TRANSAKSI
    const trxHeader = [
      "Tanggal",
      "ID Transaksi",
      "Pelanggan",
      "Meja",
      "Item",
      "Total (Rp)",
      "HPP (Rp)",
      "Laba Kotor (Rp)",
      "Metode Bayar",
      "Status",
    ];
    const trxRows = (transactions || [])
      .filter((t: any) => t.status === "paid")
      .map((trx: any) => {
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
        return [
          fmtDate(trx.created_at),
          trx.id?.substring(0, 8).toUpperCase(),
          trx.customer_name || "-",
          trx.table_number || "-",
          items,
          trx.total_amount || 0,
          totalHpp,
          (trx.total_amount || 0) - totalHpp,
          trx.payment_method || "Tunai",
          trx.status,
        ];
      });

    // INVENTORI
    const invHeader = [
      "Nama Produk",
      "Barcode",
      "Harga Jual (Rp)",
      "HPP / Modal (Rp)",
      "Margin (Rp)",
      "Stok Saat Ini",
      "Terjual (Periode)",
      "Total Terjual",
    ];
    const invRows = (inventory || []).map((item: any) => [
      item.variant_name || item.products?.name || "-",
      item.barcode || "-",
      item.price || 0,
      item.hpp || 0,
      (item.price || 0) - (item.hpp || 0),
      item.stock || 0,
      (soldMap || {})[item.id] || 0,
      item.sold_count || 0,
    ]);

    // PENGELUARAN
    const expHeader = ["Tanggal", "Kategori", "Deskripsi", "Jumlah (Rp)"];
    const expRows = (expenses || []).map((exp: any) => [
      fmtDate(exp.created_at),
      exp.category || "-",
      exp.description || "-",
      exp.amount || 0,
    ]);

    // ── Ensure sheets exist ────────────────────────────────────────────
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets =
      spreadsheet.data.sheets?.map((s) => s.properties?.title) || [];

    const requiredSheets = ["Transaksi", "Inventori", "Pengeluaran"];
    const sheetsToCreate = requiredSheets.filter(
      (name) => !existingSheets.includes(name)
    );

    if (sheetsToCreate.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: sheetsToCreate.map((title) => ({
            addSheet: { properties: { title } },
          })),
        },
      });
    }

    // ── Clear & write each sheet ───────────────────────────────────────
    const writeSheet = async (
      sheetName: string,
      header: string[],
      rows: any[][]
    ) => {
      // Clear existing data
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A:Z`,
      });

      // Write header + rows
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [header, ...rows],
        },
      });
    };

    await writeSheet("Transaksi", trxHeader, trxRows);
    await writeSheet("Inventori", invHeader, invRows);
    await writeSheet("Pengeluaran", expHeader, expRows);

    // ── Format header rows (bold + colored bg) ─────────────────────────
    const sheetMap = await sheets.spreadsheets.get({ spreadsheetId });
    const formatRequests = (sheetMap.data.sheets || [])
      .filter((s) => requiredSheets.includes(s.properties?.title || ""))
      .map((s) => ({
        repeatCell: {
          range: {
            sheetId: s.properties?.sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.22, green: 0.46, blue: 0.87 },
              textFormat: {
                bold: true,
                foregroundColor: { red: 1, green: 1, blue: 1 },
              },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      }));

    if (formatRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: formatRequests },
      });
    }

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    return NextResponse.json({
      message: `Berhasil sync! ${trxRows.length} transaksi, ${invRows.length} produk, ${expRows.length} pengeluaran.`,
      url: sheetUrl,
    });
  } catch (error: any) {
    console.error("Google Sheets sync error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
