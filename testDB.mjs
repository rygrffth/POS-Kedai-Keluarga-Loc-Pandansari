import { createClient } from '@supabase/supabase-js';
const url = "https://ppsokftpupdnwpqbtvpa.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwc29rZnRwdXBkbndwcWJ0dnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjQ1MjMsImV4cCI6MjA4OTk0MDUyM30.BixlrdyLnq7lqE8MnrjFJuj0t9dofidPnkbsNj48vmc";

const supabase = createClient(url, key);

async function check() {
  const p1 = await supabase.from('product_variants').select('*').limit(1);
  const p2 = await supabase.from('Variants').select('*').limit(1);
  const p3 = await supabase.from('products').select('*').limit(1);
  const p4 = await supabase.from('Products').select('*').limit(1);
  const p5 = await supabase.from('transactions').select('*').limit(1);
  const p6 = await supabase.from('transaction_items').select('*').limit(1);
  const p7 = await supabase.from('Transactions').select('*').limit(1);
  
  console.log("product_variants error:", p1.error?.message || "SUCCESS");
  console.log("Variants error:", p2.error?.message || "SUCCESS");
  console.log("products error:", p3.error?.message || "SUCCESS");
  console.log("Products error:", p4.error?.message || "SUCCESS");
  console.log("transactions error:", p5.error?.message || "SUCCESS");
  console.log("transaction_items error:", p6.error?.message || "SUCCESS");
  console.log("Transactions error:", p7.error?.message || "SUCCESS");
}
check();
