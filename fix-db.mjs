import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fix() {
  console.log("Fetching data...");
  const { data: variants } = await supabase.from('product_variants').select('*');
  const { data: transactions } = await supabase.from('transactions').select('id, status');
  const { data: items } = await supabase.from('transaction_items').select('*');

  const paidTrxIds = new Set(transactions.filter(t => t.status === 'paid').map(t => t.id));

  // Calculate actual sold qty for each variant ID from explicitly PAID transactions
  const actualSoldMap = {};
  for (const item of items) {
    if (paidTrxIds.has(item.transaction_id) && item.variant_id) {
      actualSoldMap[item.variant_id] = (actualSoldMap[item.variant_id] || 0) + item.quantity;
    }
  }

  for (const variant of variants) {
    const actualSold = actualSoldMap[variant.id] || 0;
    const currentSold = variant.sold_count || 0;
    
    if (actualSold !== currentSold) {
      console.log(`Fixing ${variant.variant_name || 'Variant'}:`);
      console.log(`  Current Sold: ${currentSold} -> Actual Sold: ${actualSold}`);
      
      const diff = currentSold - actualSold;
      const newStock = (variant.stock || 0) + diff;
      
      console.log(`  Updating Stock: ${variant.stock} -> ${newStock}`);
      
      await supabase.from('product_variants').update({ 
        sold_count: actualSold, 
        stock: newStock 
      }).eq('id', variant.id);
      
      console.log("  Done.");
    }
  }
  console.log("All fixed!");
}

fix().catch(console.error);
