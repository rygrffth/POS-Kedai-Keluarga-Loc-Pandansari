const url = "https://ppsokftpupdnwpqbtvpa.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwc29rZnRwdXBkbndwcWJ0dnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjQ1MjMsImV4cCI6MjA4OTk0MDUyM30.BixlrdyLnq7lqE8MnrjFJuj0t9dofidPnkbsNj48vmc";

async function fetchTables() {
  const res = await fetch(`${url}/rest/v1/?apikey=${key}`);
  const data = await res.json();
  if(data && data.definitions) {
    const tableNames = Object.keys(data.definitions);
    console.log("Found tables:", tableNames.join(', '));
    
    function logSchema(name) {
      if(data.definitions[name] && data.definitions[name].properties) {
        console.log(`\nTable '${name}' columns:`, Object.keys(data.definitions[name].properties).join(', '));
      }
    }
    
    tableNames.forEach(logSchema);
  } else {
    console.log("No definitions found", data);
  }
}
fetchTables();
