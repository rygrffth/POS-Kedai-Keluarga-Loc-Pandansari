const URL = "https://ppsokftpupdnwpqbtvpa.supabase.co/rest/v1";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwc29rZnRwdXBkbndwcWJ0dnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjQ1MjMsImV4cCI6MjA4OTk0MDUyM30.BixlrdyLnq7lqE8MnrjFJuj0t9dofidPnkbsNj48vmc";

const HEADERS = {
  "apikey": KEY,
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};

async function run() {
  try {
    const resV = await fetch(`${URL}/product_variants?select=*`, { headers: HEADERS });
    const variants = await resV.json();

    const resT = await fetch(`${URL}/transactions?select=id,status&status=eq.paid`, { headers: HEADERS });
    const transactions = await resT.json();
    const paidIds = new Set(transactions.map(t => t.id));

    const resI = await fetch(`${URL}/transaction_items?select=*`, { headers: HEADERS });
    const items = await resI.json();

    const actualSoldMap = {};
    for (const item of items) {
      if (paidIds.has(item.transaction_id) && item.variant_id) {
        actualSoldMap[item.variant_id] = (actualSoldMap[item.variant_id] || 0) + item.quantity;
      }
    }

    for (const variant of variants) {
      const actualSold = actualSoldMap[variant.id] || 0;
      const currentSold = variant.sold_count || 0;

      if (actualSold !== currentSold) {
        const diff = currentSold - actualSold;
        const newStock = (variant.stock || 0) + diff;
        
        console.log(`Fixing ${variant.variant_name || variant.id}:`);
        console.log(`  Current Sold: ${currentSold} -> Actual: ${actualSold}`);
        console.log(`  Current Stock: ${variant.stock} -> Actual: ${newStock}`);

        await fetch(`${URL}/product_variants?id=eq.${variant.id}`, {
          method: "PATCH",
          headers: HEADERS,
          body: JSON.stringify({ sold_count: actualSold, stock: newStock })
        });
        console.log("  Successfully synced!");
      }
    }
    console.log("Done syncing DB!");
  } catch (err) {
    console.error(err);
  }
}

run();
