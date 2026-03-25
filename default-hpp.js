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

    for (const variant of variants) {
      if ((variant.hpp || 0) === 0 && variant.price > 0) {
        const defaultHpp = Math.floor(variant.price * 0.5); // Set HPP to 50% of price
        console.log(`Setting HPP for ${variant.variant_name} to ${defaultHpp}`);
        
        await fetch(`${URL}/product_variants?id=eq.${variant.id}`, {
          method: "PATCH",
          headers: HEADERS,
          body: JSON.stringify({ hpp: defaultHpp })
        });
      }
    }
    console.log("Done seeding HPP!");
  } catch (err) {
    console.error(err);
  }
}

run();
