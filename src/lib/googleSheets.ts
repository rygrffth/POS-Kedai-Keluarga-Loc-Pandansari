// ---------------------------------------------------------------------------
//  Google Sheets Sync – client-side helper
//  Calls the /api/sync-sheets API route to push data to Google Sheets.
// ---------------------------------------------------------------------------

export interface SyncPayload {
  transactions: any[];
  inventory: any[];
  soldMap: Record<string, number>;
  expenses: any[];
  analysisLimit?: number;
}

export async function syncToGoogleSheets(payload: SyncPayload): Promise<{ success: boolean; message: string; url?: string }> {
  try {
    const res = await fetch("/api/sync-sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal sinkronisasi");
    return { success: true, message: data.message || "Berhasil sinkron ke Google Sheets!", url: data.url };
  } catch (err: any) {
    return { success: false, message: err.message || "Gagal terhubung ke server" };
  }
}
